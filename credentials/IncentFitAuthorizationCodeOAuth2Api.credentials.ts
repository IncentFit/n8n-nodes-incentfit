import type {
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class IncentFitAuthorizationCodeOAuth2Api implements ICredentialType {
	name = 'incentFitAuthorizationCodeOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'IncentFit User Login OAuth2 API';

	icon: Icon = 'file:../nodes/IncentFit/incentfit.svg';

	documentationUrl = 'https://api.incentfit.com/v2/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'authorizationCode',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://api.incentfit.com/v2/oauth2/authorize',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://api.incentfit.com/v2/oauth2/token',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'string',
			default: 'openid api',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
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
