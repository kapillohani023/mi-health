const REPO = "https://github.com/kapillohani023/mi-health";
const nav = `<p style="color:#666"><a href="/">Home</a> · <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a></p>`;
export const UPDATED = "29 October 2026";

export const HOME = `${nav}
<p>mi-health is a personal, single-user integration. It reads the owner's own step count and sleep data from the Google Health API and makes it available to the owner's personal AI assistant through a private, token-protected Model Context Protocol (MCP) endpoint.</p>
<p>It is not offered to the public, and only the owner's Google account is connected. Source code: <a href="${REPO}">${REPO}</a>.</p>`;

export const PRIVACY = `${nav}<p><em>Last updated: ${UPDATED}</em></p>
<h3>What data is accessed</h3>
<p>With the owner's consent, mi-health requests read-only access to Google Health activity and fitness data (daily step counts) and sleep data (sleep sessions and stages), using the scopes <code>googlehealth.activity_and_fitness.readonly</code> and <code>googlehealth.sleep.readonly</code>. It never writes to or changes any Google data.</p>
<h3>How data is used</h3>
<p>The data is used only to answer the owner's questions about their own steps and sleep through their personal AI assistant. It is not used for advertising, profiling, or any other purpose, and it is not sold, shared with, or transferred to third parties, except as needed to deliver those answers to the owner's own assistant.</p>
<h3>Storage and retention</h3>
<p>Health data is fetched on demand and is not stored permanently. The only thing stored is the OAuth refresh token, plus a short-lived access token, kept encrypted at rest in Cloudflare Workers KV so the service can keep reading the owner's data. Once access is revoked, the stored token stops working and no further data can be read.</p>
<h3>Revoking access</h3>
<p>The owner can revoke access at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
<h3>Google API Services User Data Policy</h3>
<p>mi-health's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
<h3>Contact</h3>
<p>Open an issue at <a href="${REPO}/issues">${REPO}/issues</a>.</p>`;

export const TERMS = `${nav}<p><em>Last updated: ${UPDATED}</em></p>
<p>mi-health is a personal tool operated by its owner for their own use. By connecting a Google account you agree to the following.</p>
<ol>
<li><strong>Personal use only.</strong> The service is meant only for its owner and is not offered to other users.</li>
<li><strong>Read-only access.</strong> The service reads step and sleep data and never changes your Google data. You can revoke access at any time at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</li>
<li><strong>Not medical advice.</strong> The data and any summaries are for general information only and are not medical advice.</li>
<li><strong>No warranty.</strong> The service is provided "as is" without warranties of any kind, and may change or stop at any time.</li>
<li><strong>Privacy.</strong> Data handling is described in the <a href="/privacy">privacy policy</a>.</li>
</ol>
<p>Questions: <a href="${REPO}/issues">${REPO}/issues</a>.</p>`;
