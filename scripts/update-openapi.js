#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://api.incentfit.com/v2/openapi.json';
const OUTPUT_PATH = path.resolve(__dirname, '..', 'nodes', 'IncentFit', 'openapi.json');

const REMOVE_PATH_PREFIXES = [
	'/v2/oauth2',
	'/v2/widget',
	'/v2/mcp',
	'/v2/openapi',
	'/v2/scim/ResourceTypes',
	'/v2/scim/Schemas',
	'/v2/scim/ServiceProviderConfig',
];

async function fetchText(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
	return res.text();
}

/**
 * Resolve allOf references in request body schemas.
 * n8n-openapi-node doesn't handle allOf, so we flatten them into a single schema.
 */
function mergeAllOf(schema, schemas) {
	if (!schema.allOf) return schema;
	const merged = { type: 'object', properties: {} };
	for (const part of schema.allOf) {
		let resolved = part;
		if (part.$ref) {
			const refName = part.$ref.replace('#/components/schemas/', '');
			resolved = schemas[refName] || {};
		}
		Object.assign(merged.properties, resolved.properties || {});
		if (Array.isArray(resolved.required)) {
			merged.required = [...new Set([...(merged.required || []), ...resolved.required])];
		}
		if (resolved.description && !merged.description) {
			merged.description = resolved.description;
		}
	}
	return merged;
}

function resolveAllOf(doc) {
	const schemas = doc.components?.schemas || {};

	// Resolve allOf in named component schemas
	for (const [name, schema] of Object.entries(schemas)) {
		if (schema.allOf) {
			schemas[name] = mergeAllOf(schema, schemas);
		}
	}

	// Resolve allOf in inline request body schemas in paths
	for (const pathItem of Object.values(doc.paths || {})) {
		for (const operation of Object.values(pathItem)) {
			const bodySchema = operation?.requestBody?.content?.['application/json']?.schema;
			if (bodySchema?.allOf) {
				operation.requestBody.content['application/json'].schema = mergeAllOf(bodySchema, schemas);
			}
		}
	}
}

async function main() {
	const url = process.argv[2] || DEFAULT_URL;
	console.log(`Fetching ${url} ...`);

	const raw = await fetchText(url);
	let doc;
	try {
		doc = JSON.parse(raw);
	} catch {
		console.error('Failed to parse JSON response');
		process.exit(1);
	}

	// Resolve allOf schemas (needed for n8n-openapi-node compatibility)
	resolveAllOf(doc);

	// Remove paths
	const removedPaths = [];
	for (const pathKey of Object.keys(doc.paths || {})) {
		if (REMOVE_PATH_PREFIXES.some((prefix) => pathKey.startsWith(prefix))) {
			delete doc.paths[pathKey];
			removedPaths.push(pathKey);
		}
	}

	// Collect tags still in use
	const usedTags = new Set();
	for (const methods of Object.values(doc.paths || {})) {
		for (const op of Object.values(methods)) {
			if (op.tags) op.tags.forEach((t) => usedTags.add(t));
		}
	}

	// Remove orphaned top-level tags
	let removedTagCount = 0;
	if (Array.isArray(doc.tags)) {
		const before = doc.tags.length;
		doc.tags = doc.tags.filter((t) => usedTags.has(t.name));
		removedTagCount = before - doc.tags.length;
	}

	// Remove x-tagGroups if present
	delete doc['x-tagGroups'];

	fs.writeFileSync(OUTPUT_PATH, JSON.stringify(doc, null, 2) + '\n');

	console.log(`\nWritten to ${OUTPUT_PATH}`);
	console.log(`  Paths kept: ${Object.keys(doc.paths).length}`);
	console.log(`  Paths removed: ${removedPaths.length}`);
	console.log(`  Tags kept: ${(doc.tags || []).length} (${[...usedTags].join(', ')})`);
	console.log(`  Orphaned tags removed: ${removedTagCount}`);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
