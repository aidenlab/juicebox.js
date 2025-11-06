/**
 * Wrapper for w3c-xmlhttprequest for remote HTTP requests in tests
 */

import * as w3cXHR from 'w3c-xmlhttprequest';

// Export XMLHttpRequest from w3c-xmlhttprequest
// The package exports XMLHttpRequest as a named export
export const XMLHttpRequest = w3cXHR.XMLHttpRequest || w3cXHR.default || w3cXHR;

