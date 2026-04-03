import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IHttpRequestOptions,
	INodeType,
	INodeTypeDescription,
	INodeProperties,
	INodePropertyOptions,
	IExecuteSingleFunctions,
} from 'n8n-workflow';
import { N8NPropertiesBuilder } from '@devlikeapro/n8n-openapi-node';
import * as doc from './openapi.json';

const DEV_BASE_URL = process.env.INCENTFIT_BASE_URL?.replace(/\/$/, '') || null;
const DEV_DEBUG = process.env.INCENTFIT_DEBUG === 'true' || process.env.INCENTFIT_DEBUG === '1';
const DEV_LOG_FILE = process.env.INCENTFIT_LOG_FILE ?? '/tmp/incentfit-n8n-debug.log';

const HIDDEN_OVERRIDE = { type: 'hidden' as const, default: '', routing: { send: undefined } };

const properties = new N8NPropertiesBuilder(doc).build([
	{ find: { name: 'filter' }, replace: HIDDEN_OVERRIDE },
	{ find: { name: 'sort' }, replace: HIDDEN_OVERRIDE },
	{ find: { name: 'search' }, replace: HIDDEN_OVERRIDE },
]);

// Derive REST resource tags and item schema names from the OpenAPI spec
type OpenApiSchema = { properties?: Record<string, { type?: string; format?: string; items?: { $ref?: string } }>; items?: { $ref?: string } };
type OpenApiDoc = { paths: Record<string, Record<string, { tags?: string[]; summary?: string; responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>; components: { schemas: Record<string, OpenApiSchema> } };
const _doc = doc as unknown as OpenApiDoc;
const _restPaths = Object.entries(_doc.paths).filter(([p]) => p.startsWith('/v2/rest/'));

const REST_SCHEMA_NAMES = [...new Set(
	_restPaths.map(([, methods]) => {
		const op = methods.get ?? methods.post;
		const ref = op?.responses?.['200']?.content?.['application/json']?.schema?.$ref ?? '';
		const pageName = ref.replace('#/components/schemas/', '');
		const pageSchema = _doc.components.schemas[pageName];
		// Page schemas wrap items in properties.data; some may use items directly
		const itemRef = pageSchema?.properties?.['data']?.items?.$ref ?? pageSchema?.items?.$ref ?? '';
		return itemRef.replace('#/components/schemas/', '');
	}).filter(Boolean),
)];

// Derive field types from spec for typed value inputs in the filter UI
type FieldKind = 'boolean' | 'dateTime' | 'date' | 'number' | 'string';
const FIELD_KIND_MAP: Record<string, FieldKind> = {};
REST_SCHEMA_NAMES.forEach((name) => {
	Object.entries(_doc.components.schemas[name]?.properties ?? {}).forEach(([field, def]) => {
		if (def.type === 'boolean') FIELD_KIND_MAP[field] = 'boolean';
		else if (def.format === 'date-time') FIELD_KIND_MAP[field] = 'dateTime';
		else if (def.format === 'date') FIELD_KIND_MAP[field] = 'date';
		else if (def.type === 'number' || def.type === 'integer') FIELD_KIND_MAP[field] = 'number';
		else FIELD_KIND_MAP[field] = 'string';
	});
});
const BOOLEAN_FIELDS = Object.entries(FIELD_KIND_MAP).filter(([, k]) => k === 'boolean').map(([f]) => f);
const DATETIME_FIELDS = Object.entries(FIELD_KIND_MAP).filter(([, k]) => k === 'dateTime').map(([f]) => f);
const DATE_FIELDS = Object.entries(FIELD_KIND_MAP).filter(([, k]) => k === 'date').map(([f]) => f);
const NUMBER_FIELDS = Object.entries(FIELD_KIND_MAP).filter(([, k]) => k === 'number').map(([f]) => f);
const TYPED_FIELDS = [...BOOLEAN_FIELDS, ...DATETIME_FIELDS, ...DATE_FIELDS, ...NUMBER_FIELDS];

// Build a path→schema mapping from the spec
const PATH_SCHEMA_MAP: Record<string, { resource: string; schemaName: string }> = {};
_restPaths.forEach(([path, methods]) => {
	const op = methods.get ?? methods.post;
	const tags = op?.tags ?? [];
	const ref = op?.responses?.['200']?.content?.['application/json']?.schema?.$ref ?? '';
	const pageName = ref.replace('#/components/schemas/', '');
	const pageSchema = _doc.components.schemas[pageName];
	const itemRef = pageSchema?.properties?.['data']?.items?.$ref ?? pageSchema?.items?.$ref ?? '';
	const schemaName = itemRef.replace('#/components/schemas/', '');
	if (schemaName) PATH_SCHEMA_MAP[path] = { resource: tags[0] ?? '', schemaName };
});

// Derive per-operation field options using n8n-generated operation values (matched via routing URL)
type OperationMeta = { resource: string; fields: INodePropertyOptions[] };
const OPERATION_FIELD_OPTIONS: Record<string, OperationMeta> = {};
properties.forEach((prop) => {
	if (prop.name !== 'operation' || !Array.isArray(prop.options)) return;
	prop.options.forEach((opt) => {
		const url = (opt as { routing?: { request?: { url?: string } } }).routing?.request?.url ?? '';
		const path = url.replace(/^=/, '');
		const meta = PATH_SCHEMA_MAP[path];
		if (!meta) return;
		const fields = Object.keys(_doc.components.schemas[meta.schemaName]?.properties ?? {})
			.sort()
			.map((f) => ({ name: f, value: f }));
		OPERATION_FIELD_OPTIONS[(opt as INodePropertyOptions).value as string] = { resource: meta.resource, fields };
	});
});

function operationParamKey(operationName: string): string {
	return operationName.replace(/\s+/g, '');
}

function makeFilterConditionValues(fieldOptions: INodePropertyOptions[]): INodeProperties[] {
	return [
		{
			displayName: 'Field',
			name: 'field',
			type: 'options',
			default: '',
			options: fieldOptions,
		},
		{
			displayName: 'Operator',
			name: 'operator',
			type: 'options',
			options: REST_FILTER_OPERATORS,
			default: 'equals',
		},
		{
			displayName: 'Value',
			name: 'value',
			type: 'string',
			default: '',
			displayOptions: { hide: { operator: ['nulled', 'notNulled'], field: TYPED_FIELDS } },
		},
		{
			displayName: 'Value',
			name: 'valueBool',
			type: 'options',
			options: [{ name: 'True', value: 'true' }, { name: 'False', value: 'false' }],
			default: 'true',
			displayOptions: { show: { field: BOOLEAN_FIELDS }, hide: { operator: ['nulled', 'notNulled'] } },
		},
		{
			displayName: 'Value',
			name: 'valueDateTime',
			type: 'dateTime',
			default: '',
			displayOptions: { show: { field: DATETIME_FIELDS }, hide: { operator: ['nulled', 'notNulled'] } },
		},
		{
			displayName: 'Value',
			name: 'valueDate',
			type: 'dateTime',
			default: '',
			displayOptions: { show: { field: DATE_FIELDS }, hide: { operator: ['nulled', 'notNulled'] } },
		},
		{
			displayName: 'Value',
			name: 'valueNumber',
			type: 'number',
			default: 0,
			displayOptions: { show: { field: NUMBER_FIELDS }, hide: { operator: ['nulled', 'notNulled'] } },
		},
		{
			displayName: 'Value To',
			name: 'valueTo',
			type: 'string',
			default: '',
			description: 'Upper bound for range filters',
			displayOptions: { show: { operator: ['inRange', 'notInRange'] }, hide: { field: [...DATETIME_FIELDS, ...DATE_FIELDS, ...NUMBER_FIELDS] } },
		},
		{
			displayName: 'Value To',
			name: 'valueToNumber',
			type: 'number',
			default: 0,
			description: 'Upper bound for range filters',
			displayOptions: { show: { operator: ['inRange', 'notInRange'], field: NUMBER_FIELDS } },
		},
		{
			displayName: 'Value To',
			name: 'valueToDateTime',
			type: 'dateTime',
			default: '',
			description: 'Upper bound for range filters',
			displayOptions: { show: { operator: ['inRange', 'notInRange'], field: [...DATETIME_FIELDS, ...DATE_FIELDS] } },
		},
	] as INodeProperties[];
}

// --- SCIM filter ---

const SCIM_FILTER_SHOW = {
	resource: ['User Provisioning'],
	operation: ['Scim List Users'],
};

function debugLog(message: string, pretty?: string): void {
	if (!DEV_DEBUG) return;
	const line = `[IncentFit DEBUG] ${message}`;
	process.stdout.write(line + '\n');
	// Lazy require so fs is never imported in production (only reachable when DEV_DEBUG is true)
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	(require('fs') as typeof import('fs')).appendFileSync(DEV_LOG_FILE, (pretty ?? line) + '\n');
}

async function cleanEmptyBodyParams(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	if (!requestOptions.body || typeof requestOptions.body !== 'object') return requestOptions;
	const body = requestOptions.body as Record<string, unknown>;
	for (const key of Object.keys(body)) {
		if (body[key] === '' || body[key] === null || body[key] === undefined) {
			delete body[key];
		}
	}
	return requestOptions;
}

async function applyDebugLogging(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	if (!DEV_DEBUG) return requestOptions;
	debugLog(`${requestOptions.method} ${requestOptions.baseURL ?? ''}${requestOptions.url}`);
	if (requestOptions.qs && Object.keys(requestOptions.qs).length) {
		debugLog(`Query: ${JSON.stringify(requestOptions.qs)}`);
	}
	if (requestOptions.body) {
		const compact = JSON.stringify(requestOptions.body);
		const pretty = JSON.stringify(requestOptions.body, null, 2);
		debugLog(`Body (partial): ${compact}`, `[IncentFit DEBUG] Body (partial):\n${pretty}`);
	}
	return requestOptions;
}

async function applyScimFilter(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const filterMode = this.getNodeParameter('filterMode', 'simple') as string;
	let filterString = '';

	if (filterMode === 'advanced') {
		filterString = this.getNodeParameter('filterRaw', '') as string;
	} else {
		const combinator = this.getNodeParameter('filterCombinator', 'and') as string;
		const scimFilters = this.getNodeParameter('scimFilters', {}) as {
			conditions?: Array<{ field: string; operator: string; value: string }>;
		};
		const conditions = scimFilters.conditions ?? [];

		if (conditions.length > 0) {
			const parts = conditions.map((c) => {
				if (c.operator === 'pr') return `${c.field} pr`;
				if (c.field === 'active') return `${c.field} ${c.operator} ${c.value}`;
				return `${c.field} ${c.operator} "${c.value}"`;
			});
			filterString = parts.join(` ${combinator} `);
		}
	}

	if (filterString) {
		requestOptions.qs = {
			...(requestOptions.qs as Record<string, string> | undefined),
			filter: filterString,
		};
	}

	return requestOptions;
}

// --- REST filter/sort/search ---

const REST_RESOURCES = [...new Set(
	_restPaths.flatMap(([, methods]) => (methods.get ?? methods.post)?.tags ?? []),
)];
const REST_FILTER_SHOW = { resource: REST_RESOURCES };

const REST_FILTER_OPERATORS: INodePropertyOptions[] = [
	{ name: 'Contains', value: 'contains' },
	{ name: 'Ends With', value: 'endsWith' },
	{ name: 'Equals', value: 'equals' },
	{ name: 'Greater Than', value: 'greaterThan' },
	{ name: 'Greater Than or Equal', value: 'greaterThanOrEqual' },
	{ name: 'In', value: 'in' },
	{ name: 'In Range', value: 'inRange' },
	{ name: 'Is Empty', value: 'nulled' },
	{ name: 'Is Not Empty', value: 'notNulled' },
	{ name: 'Less Than', value: 'lessThan' },
	{ name: 'Less Than or Equal', value: 'lessThanOrEqual' },
	{ name: 'Not Contains', value: 'notContains' },
	{ name: 'Not Equal', value: 'notEqual' },
	{ name: 'Not In', value: 'notIn' },
	{ name: 'Not In Range', value: 'notInRange' },
	{ name: 'Starts With', value: 'startsWith' },
];

async function applyRestFilter(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const filterMode = this.getNodeParameter('restFilterMode', 'simple') as string;

	const body = (requestOptions.body ?? {}) as Record<string, unknown>;
	delete body['filter'];
	requestOptions.body = body;

	if (filterMode === 'advanced') {
		const raw = this.getNodeParameter('restFilterRaw', '') as string;
		if (raw) {
			try {
				body['filter'] = JSON.parse(raw);
			} catch {
				throw new NodeOperationError(this.getNode(), `"Raw Filter" contains invalid JSON: ${raw.slice(0, 80)}`);
			}
		}
		return requestOptions;
	}

	const operation = this.getNodeParameter('operation', '') as string;
	const restFilters = this.getNodeParameter(`restFilters${operationParamKey(operation)}`, {}) as {
		conditions?: Array<{
			field: string; operator: string;
			value: string; valueBool: string; valueDateTime: string; valueDate: string; valueNumber: number;
			valueTo: string; valueToNumber: number; valueToDateTime: string;
		}>;
	};
	const conditions = restFilters.conditions ?? [];
	if (conditions.length === 0) return requestOptions;

	const filterObj: Record<string, { values: Array<Record<string, unknown>> }> = {};
	for (const c of conditions) {
		if (!filterObj[c.field]) {
			filterObj[c.field] = { values: [] };
		}
		const entry: Record<string, unknown> = { type: c.operator };
		if (!['nulled', 'notNulled'].includes(c.operator)) {
			const kind = FIELD_KIND_MAP[c.field] ?? 'string';
			if (kind === 'boolean') entry['value'] = c.valueBool === 'true';
			else if (kind === 'dateTime') entry['value'] = c.valueDateTime;
			else if (kind === 'date') entry['value'] = c.valueDate;
			else if (kind === 'number') entry['value'] = c.valueNumber;
			else entry['value'] = c.value;
		}
		if (['inRange', 'notInRange'].includes(c.operator)) {
			const kind = FIELD_KIND_MAP[c.field] ?? 'string';
			if (kind === 'number') entry['valueTo'] = c.valueToNumber;
			else if (kind === 'dateTime' || kind === 'date') entry['valueTo'] = c.valueToDateTime;
			else entry['valueTo'] = c.valueTo;
		}
		filterObj[c.field].values.push(entry);
	}

	body['filter'] = filterObj;
	return requestOptions;
}

async function applyRestSort(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const body = (requestOptions.body ?? {}) as Record<string, unknown>;
	delete body['sort'];
	requestOptions.body = body;

	const operation = this.getNodeParameter('operation', '') as string;
	const restSort = this.getNodeParameter(`restSort${operationParamKey(operation)}`, {}) as {
		fields?: Array<{ property: string; direction: string }>;
	};
	const fields = restSort.fields ?? [];
	if (fields.length === 0) return requestOptions;

	body['sort'] = fields.map((f) => ({ property: f.property, direction: f.direction }));
	return requestOptions;
}

async function applyRestSearch(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const body = (requestOptions.body ?? {}) as Record<string, unknown>;
	delete body['search'];
	requestOptions.body = body;

	const searchText = this.getNodeParameter('restSearchText', '') as string;
	if (!searchText) return requestOptions;

	const restSearchColumns = this.getNodeParameter('restSearchColumns', '') as string;
	const columns = restSearchColumns
		? restSearchColumns.split(',').map((s) => s.trim()).filter(Boolean)
		: undefined;

	body['search'] = { text: searchText, columns };
	return requestOptions;
}

// --- Node definition ---

export class IncentFit implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'IncentFit',
		name: 'incentFit',
		icon: 'file:incentfit.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with the IncentFit wellness incentive API',
		defaults: {
			name: 'IncentFit',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'incentFitClientCredentialsOAuth2Api',
				required: true,
				displayOptions: {
					show: {
						authentication: ['clientCredentials'],
					},
				},
			},
			{
				name: 'incentFitAuthorizationCodeOAuth2Api',
				required: true,
				displayOptions: {
					show: {
						authentication: ['oAuth2'],
					},
				},
			},
		],
		requestDefaults: {
			baseURL: DEV_BASE_URL ?? 'https://api.incentfit.com',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'Client Credentials', value: 'clientCredentials' },
					{ name: 'OAuth2', value: 'oAuth2' },
				],
				default: 'clientCredentials',
			},
			...properties,

			// ---- SCIM filter UI ----
			{
				displayName: 'Filter Mode',
				name: 'filterMode',
				type: 'options',
				options: [
					{ name: 'Simple', value: 'simple' },
					{ name: 'Advanced (Raw SCIM)', value: 'advanced' },
				],
				default: 'simple',
				displayOptions: { show: SCIM_FILTER_SHOW },
				routing: {
					send: {
						type: 'query',
						property: 'filter',
						value: '',
						preSend: [applyScimFilter, applyDebugLogging],
					},
				},
			},
			{
				displayName: 'Combine Filters With',
				name: 'filterCombinator',
				type: 'options',
				options: [
					{ name: 'AND', value: 'and' },
					{ name: 'OR', value: 'or' },
				],
				default: 'and',
				displayOptions: { show: { ...SCIM_FILTER_SHOW, filterMode: ['simple'] } },
			},
			{
				displayName: 'Filters',
				name: 'scimFilters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				displayOptions: { show: { ...SCIM_FILTER_SHOW, filterMode: ['simple'] } },
				options: [
					{
						displayName: 'Filter',
						name: 'conditions',
						values: [
							{
								displayName: 'Field',
								name: 'field',
								type: 'options',
								options: [
									{ name: 'Active', value: 'active' },
									{
										name: 'Birthday',
										value: 'urn:incentfit:params:scim:schemas:1.0:Individual:Birthday',
									},
									{ name: 'Email', value: 'userName' },
									{
										name: 'Employee Number',
										value:
											'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber',
									},
									{ name: 'External ID', value: 'externalId' },
									{ name: 'First Name', value: 'name.givenName' },
									{
										name: 'Gender',
										value: 'urn:incentfit:params:scim:schemas:1.0:Individual:Gender',
									},
									{ name: 'ID', value: 'id' },
									{ name: 'Last Name', value: 'name.familyName' },
									{
										name: 'Organization',
										value:
											'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:organization',
									},
									{
										name: 'Tags',
										value: 'urn:incentfit:params:scim:schemas:1.0:Individual:Tags',
									},
									{
										name: 'User Group ID',
										value: 'urn:incentfit:params:scim:schemas:1.0:Individual:UserGroupID',
									},
								],
								default: 'userName',
							},
							{
								displayName: 'Operator',
								name: 'operator',
								type: 'options',
								options: [
									{ name: 'Contains', value: 'co' },
									{ name: 'Ends With', value: 'ew' },
									{ name: 'Equals', value: 'eq' },
									{ name: 'Greater Than', value: 'gt' },
									{ name: 'Greater Than or Equal', value: 'ge' },
									{ name: 'Less Than', value: 'lt' },
									{ name: 'Less Than or Equal', value: 'le' },
									{ name: 'Not Equals', value: 'ne' },
									{ name: 'Present', value: 'pr' },
									{ name: 'Starts With', value: 'sw' },
								],
								default: 'eq',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								displayOptions: { hide: { operator: ['pr'] } },
							},
						],
					},
				],
			},
			{
				displayName: 'Filter Expression',
				name: 'filterRaw',
				type: 'string',
				default: '',
				placeholder: 'userName eq "user@example.com" and active eq true',
				description:
					'Raw SCIM filter expression (RFC 7644). Supports expressions for dynamic values.',
				displayOptions: { show: { ...SCIM_FILTER_SHOW, filterMode: ['advanced'] } },
			},

			// ---- REST filter UI ----
			{
				displayName: 'Filter Mode',
				name: 'restFilterMode',
				type: 'options',
				options: [
					{ name: 'Simple', value: 'simple' },
					{ name: 'Advanced (Raw JSON)', value: 'advanced' },
				],
				default: 'simple',
				displayOptions: { show: REST_FILTER_SHOW },
				routing: {
					send: {
						type: 'body',
						property: 'filter',
						value: '',
						preSend: [applyRestFilter, cleanEmptyBodyParams, applyDebugLogging],
					},
				},
			},
			// Per-operation filter and sort fixedCollections
			...Object.entries(OPERATION_FIELD_OPTIONS).flatMap(([opName, { resource, fields: fieldOptions }]) => {
				const key = operationParamKey(opName);
				return [
					{
						displayName: 'Filters',
						name: `restFilters${key}`,
						type: 'fixedCollection' as const,
						typeOptions: { multipleValues: true },
						default: {},
						description: 'Filter by field values. ID fields accept SqID-encoded values.',
						displayOptions: { show: { resource: [resource], operation: [opName], restFilterMode: ['simple'] } },
						options: [
							{
								displayName: 'Filter',
								name: 'conditions',
								values: makeFilterConditionValues(fieldOptions),
							},
						],
					},
					{
						displayName: 'Sort',
						name: `restSort${key}`,
						type: 'fixedCollection' as const,
						typeOptions: { multipleValues: true },
						default: {},
						displayOptions: { show: { resource: [resource], operation: [opName] } },
						routing: {
							send: {
								type: 'body' as const,
								property: 'sort',
								value: '',
								preSend: [applyRestSort, cleanEmptyBodyParams, applyDebugLogging],
							},
						},
						options: [
							{
								displayName: 'Sort Field',
								name: 'fields',
								values: [
									{
										displayName: 'Field',
										name: 'property',
										type: 'options' as const,
										options: fieldOptions,
										default: fieldOptions.find((o) => o.value === 'DateModified') ? 'DateModified' : (fieldOptions[0]?.value ?? ''),
									},
									{
										displayName: 'Direction',
										name: 'direction',
										type: 'options' as const,
										options: [
											{ name: 'Ascending', value: 'asc' },
											{ name: 'Descending', value: 'desc' },
										],
										default: 'desc',
									},
								],
							},
						],
					},
				];
			}),
			{
				displayName: 'Filter JSON',
				name: 'restFilterRaw',
				type: 'json',
				default: '',
				placeholder:
					'{"IndividualID": {"values": [{"type": "equals", "value": "86Rf07xd"}]}}',
				description: 'Raw filter JSON object. Supports expressions.',
				displayOptions: { show: { ...REST_FILTER_SHOW, restFilterMode: ['advanced'] } },
			},

			// ---- REST search UI ----
			{
				displayName: 'Search Text',
				name: 'restSearchText',
				type: 'string',
				default: '',
				description: 'Full-text search across columns (matched with LIKE %text%)',
				displayOptions: { show: REST_FILTER_SHOW },
				routing: {
					send: {
						type: 'body',
						property: 'search',
						value: '',
						preSend: [applyRestSearch, cleanEmptyBodyParams, applyDebugLogging],
					},
				},
			},
			{
				displayName: 'Search Columns',
				name: 'restSearchColumns',
				type: 'string',
				default: '',
				placeholder: 'e.g. Title, OriginalUnit',
				description:
					'Comma-separated field names to search across. Leave empty to search all text fields.',
				displayOptions: { show: REST_FILTER_SHOW },
			},
		] as INodeProperties[],
	};
}
