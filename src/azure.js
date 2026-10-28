// One Microsoft Entra token for the Azure AI Services resource (OpenAI models and Speech share it).
// In Azure this is the app's managed identity; on a developer machine it falls back to `az login`.
const { DefaultAzureCredential } = require('@azure/identity');

const credential = new DefaultAzureCredential({
  managedIdentityClientId: process.env.AZURE_CLIENT_ID || undefined,
});

async function cognitiveToken() {
  return (await credential.getToken('https://cognitiveservices.azure.com/.default')).token;
}

module.exports = { cognitiveToken };
