# VM Health Diagnostic V1 - Single VM Limit

The VM Health Diagnostic module is restricted to exactly one VM per request.

Enforcement is applied at all layers:

- Portal UI uses a single-line VM hostname field and shows a 0/1 counter.
- Browser validation allows only one unique hostname.
- `submitHealthDiagnostic` API rejects more than one hostname.
- Logic App request schema sets `minItems: 1` and `maxItems: 1`.
- Logic App `maximumHostnames` is 1.
- VM loop concurrency is 1.

Other portal modules retain their existing request limits.
