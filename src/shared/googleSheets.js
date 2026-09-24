/**
 * Shared Google Sheets API & OAuth2 Service.
 * Centralizes JWT signing, OAuth token caching, and common Sheets v4 REST calls.
 */

let cachedToken = null;
let tokenExpiresAt = 0;
const cachedSheetIds = new Map();

/**
 * Converts a PEM-formatted private key (PKCS#8) to a binary ArrayBuffer.
 *
 * @param {string} pem
 * @returns {ArrayBuffer}
 */
export function pemToDer(pem) {
  const cleaned = pem
    .replace(/-----BEGIN[A-Z0-9_-]*(?: RSA)? PRIVATE KEY-----/g, "")
    .replace(/-----END[A-Z0-9_-]*(?: RSA)? PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Base64URL encode string or ArrayBuffer/Uint8Array without padding.
 *
 * @param {string|ArrayBuffer|Uint8Array} data
 * @returns {string}
 */
export function base64UrlEncode(data) {
  let str = "";
  if (typeof data === "string") {
    str = btoa(unescape(encodeURIComponent(data)));
  } else {
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    str = btoa(binary);
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Create a signed RS256 JWT for Google Service Account authentication.
 *
 * @param {string} serviceAccountEmail
 * @param {string} privateKeyPem
 * @param {string[]|string} scopes
 * @returns {Promise<string>}
 */
export async function createSignedGoogleJwt(serviceAccountEmail, privateKeyPem, scopes) {
  const formattedKey = privateKeyPem.replace(/\\n/g, "\n");
  const der = pemToDer(formattedKey);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccountEmail,
    scope: Array.isArray(scopes) ? scopes.join(" ") : scopes,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const encodedSignature = base64UrlEncode(signature);
  return `${unsignedToken}.${encodedSignature}`;
}

/**
 * Obtain a Google OAuth2 Access Token using Service Account JWT bearer assertion.
 * Caches access token until 60 seconds before expiry.
 *
 * @param {string} serviceAccountEmail
 * @param {string} privateKeyPem
 * @param {Function} [customFetch=fetch]
 * @returns {Promise<string>}
 */
export async function getGoogleAccessToken(
  serviceAccountEmail,
  privateKeyPem,
  customFetch = fetch
) {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const jwt = await createSignedGoogleJwt(
    serviceAccountEmail,
    privateKeyPem,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const res = await customFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Google OAuth token exchange failed with status ${res.status}: ${errorText}`
    );
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;

  return cachedToken;
}

/**
 * Clear token & sheet ID caches (useful in tests).
 */
export function clearTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
  cachedSheetIds.clear();
}

/**
 * Retrieve the numeric sheet ID (gid) for a given sheet tab title.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetTab
 * @param {string} accessToken
 * @param {Function} [customFetch=fetch]
 * @returns {Promise<number>}
 */
export async function getSheetNumericId(
  spreadsheetId,
  sheetTab,
  accessToken,
  customFetch = fetch
) {
  const cacheKey = `${spreadsheetId}:${sheetTab}`;
  if (cachedSheetIds.has(cacheKey)) {
    return cachedSheetIds.get(cacheKey);
  }

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;
  const res = await customFetch(metaUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    return 0;
  }

  const data = await res.json();
  const sheets = data.sheets || [];
  const targetSheet = sheets.find(
    (s) => s.properties && s.properties.title === sheetTab
  );

  const numericId = targetSheet ? targetSheet.properties.sheetId : 0;
  cachedSheetIds.set(cacheKey, numericId);
  return numericId;
}

/**
 * Fetch rows in a specified A1 range from Google Sheets.
 *
 * @param {Object} options
 * @param {string} options.spreadsheetId
 * @param {string} options.range e.g. "Refund Log!A:R"
 * @param {string} options.accessToken
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<Array<Array<any>>>}
 */
export async function fetchSheetRows({
  spreadsheetId,
  range,
  accessToken,
  customFetch = fetch,
}) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}`;
  const res = await customFetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Failed to read sheet data (${res.status}): ${errorText}`
    );
  }

  const data = await res.json();
  return data.values || [];
}

/**
 * Append a row of values to a sheet tab.
 *
 * @param {Object} options
 * @param {string} options.spreadsheetId
 * @param {string} options.tabName
 * @param {Array<any>} options.values
 * @param {string} options.accessToken
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<Object>}
 */
export async function appendSheetRow({
  spreadsheetId,
  tabName,
  values,
  accessToken,
  customFetch = fetch,
}) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    tabName
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await customFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [values] }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Failed to append row to ${tabName} (${res.status}): ${errorText}`
    );
  }

  return await res.json();
}

/**
 * Update a specific A1 cell or range.
 *
 * @param {Object} options
 * @param {string} options.spreadsheetId
 * @param {string} options.range e.g. "Refund Log!R14"
 * @param {Array<Array<any>>} options.values
 * @param {string} options.accessToken
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<Object>}
 */
export async function updateSheetCell({
  spreadsheetId,
  range,
  values,
  accessToken,
  customFetch = fetch,
}) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}?valueInputOption=USER_ENTERED`;

  const res = await customFetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Failed to update sheet range ${range} (${res.status}): ${errorText}`
    );
  }

  return await res.json();
}

/**
 * Perform a batchUpdate request on a spreadsheet.
 *
 * @param {Object} options
 * @param {string} options.spreadsheetId
 * @param {Array<Object>} options.requests
 * @param {string} options.accessToken
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<Object>}
 */
export async function batchUpdateSheet({
  spreadsheetId,
  requests,
  accessToken,
  customFetch = fetch,
}) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;

  const res = await customFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Google Sheets batchUpdate failed (${res.status}): ${errorText}`
    );
  }

  return await res.json();
}

/**
 * Ensure required tabs exist in a spreadsheet, creating missing ones if necessary.
 *
 * @param {Object} options
 * @param {string} options.spreadsheetId
 * @param {string[]} options.tabNames
 * @param {string} options.accessToken
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<string[]>} List of all sheet tab titles
 */
export async function ensureSheetTabs({
  spreadsheetId,
  tabNames,
  accessToken,
  customFetch = fetch,
}) {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;
  const metaRes = await customFetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) {
    const errorText = await metaRes.text();
    throw new Error(
      `Failed to access Google Spreadsheet (${metaRes.status}): ${errorText}`
    );
  }

  const metaData = await metaRes.json();
  const existingSheets = (metaData.sheets || []).map(
    (s) => s.properties?.title
  );

  const missingTabs = tabNames.filter((tab) => !existingSheets.includes(tab));

  if (missingTabs.length > 0) {
    const requests = missingTabs.map((tabTitle) => ({
      addSheet: {
        properties: { title: tabTitle },
      },
    }));
    await batchUpdateSheet({
      spreadsheetId,
      requests,
      accessToken,
      customFetch,
    });
    existingSheets.push(...missingTabs);
  }

  return existingSheets;
}
