# n8n-nodes-incentfit

This is an n8n community node. It lets you use [IncentFit](https://www.incentfit.com) in your n8n workflows.

IncentFit is a wellness incentive platform that helps organizations reward employees for healthy activities like exercise, sleep, and fitness routines.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  
[Compatibility](#compatibility)  
[Usage](#usage)  
[Resources](#resources)  

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

### Activities

- **Retrieve Activities** - Query user activities (exercise, steps, etc.)
- **Retrieve Activity Types** - Get activity type metadata for your organization

### Fitness Data

- **Retrieve Exercises** - Pull raw exercise data from third-party fitness sources
- **Retrieve Routines** - Pull daily fitness routine summaries
- **Retrieve Sleeps** - Pull sleep tracking data

### Payments

- **Retrieve Payments** - Query reward payments made to users

### User Provisioning (SCIM)

- **List Users** - List users with optional filter and pagination
- **Create User** - Create a new user (or reactivate a matching inactive user)
- **Get User** - Retrieve a single user by ID
- **Replace User** - Full replacement of a user resource
- **Patch User** - Partial update (e.g., deactivate a user)
- **Delete User** - Soft-delete by deactivating a user

### System

- **Ping** - Check API connectivity

## Credentials

This node supports two authentication methods. To obtain API credentials, contact [api@incentfit.com](mailto:api@incentfit.com).

### Server-to-Server (Client Credentials)

For machine-to-machine integrations with no user interaction. Tokens expire after 1 day.

1. Select **IncentFit Server-to-Server OAuth2 API** as the credential type
2. Enter your **Client ID** and **Client Secret**
3. Set the **Scope** (default: `openid api`)

### User Login (Authorization Code + PKCE)

For flows where an end-user grants access via browser login. Access tokens expire after 1 hour with 30-day refresh tokens.

1. Select **IncentFit User Login OAuth2 API** as the credential type
2. Enter your **Client ID** and **Client Secret**
3. Complete the OAuth2 authorization flow when prompted

## Compatibility

Tested with n8n v1.x. Requires Node.js v22 or higher.

## Usage

### Data Endpoints

All data retrieval endpoints accept a JSON request body with:

- **PartnerID**, **OrganizationID**, or **UserGroupID** - Entity scope (SqID encoded, provide one)
- **since** - Only return records modified after this date (default: 5 years ago)
- **limit** - Max records per page, up to 1000 (default: 100)
- **offset** - Number of records to skip (default: 0)

### SCIM User Provisioning

User endpoints follow the [SCIM 2.0 specification (RFC 7644)](https://tools.ietf.org/html/rfc7644). Entity scoping is automatic based on your API client's configuration.

### AI Agent Integration

This node has `usableAsTool` enabled, so all operations are available as tools for n8n AI Agent workflows.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [IncentFit API documentation](https://api.incentfit.com/v2/docs)
- [IncentFit website](https://www.incentfit.com)
