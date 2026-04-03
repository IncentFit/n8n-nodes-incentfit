import type {
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class IncentFitClientCredentialsOAuth2Api implements ICredentialType {
	name = 'incentFitClientCredentialsOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'IncentFit Server-to-Server OAuth2 API';

	icon: Icon = 'file:../nodes/IncentFit/incentfit.svg';

	documentationUrl = 'https://api.incentfit.com/v2/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'clientCredentials',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://api.incentfit.com/v2/oauth2/access_token',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'string',
			default: 'openid api',
			description: 'Space-delimited list of requested scope permissions',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://api.incentfit.com',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.incentfit.com',
			url: '/v2/scim/Users',
			method: 'GET',
			qs: { itemsPerPage: 1 },
		},
	};
}
