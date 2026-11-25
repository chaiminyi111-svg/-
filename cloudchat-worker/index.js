var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/hono/dist/http-exception.js
var HTTPException = class extends Error {
  static {
    __name(this, "HTTPException");
  }
  res;
  status;
  /**
  * Creates an instance of `HTTPException`.
  * @param status - HTTP status code for the exception. Defaults to 500.
  * @param options - Additional options for the exception.
  */
  constructor(status = 500, options) {
    super(options?.message, { cause: options?.cause });
    this.res = options?.res;
    this.status = status;
  }
  /**
  * Returns the response object associated with the exception.
  * If a response object is not provided, a new response is created with the error message and status code.
  * @returns The response object.
  */
  getResponse() {
    if (this.res) return new Response(this.res.body, {
      status: this.status,
      headers: this.res.headers
    });
    return new Response(this.message, { status: this.status });
  }
};

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = /* @__PURE__ */ __name((arrayBuffer, contentType) => {
  return new Response(arrayBuffer, { headers: { "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase()) } }).formData();
}, "bufferToFormData");

// node_modules/hono/dist/utils/body.js
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = /* @__PURE__ */ __name((request) => "headers" in request, "isRawRequest");
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const mediaType = (isRawRequest(request) ? request.headers : request.raw.headers).get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") return parseFormData(request, {
    all,
    dot
  });
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) return convertFormDataToBodyData(await request.bodyCache.formData, options);
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) request.bodyCache.formData = formDataPromise;
  const formData = await formDataPromise;
  if (formData) return convertFormDataToBodyData(formData, options);
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key) => {
    if (!(options.all || key.endsWith("[]"))) form[key] = value;
    else handleParsingAllValues(form, key, value);
  });
  if (options.dot) Object.entries(form).forEach(([key, value]) => {
    if (key.includes(".")) {
      handleParsingNestedValues(form, key, value, nestingState);
      delete form[key];
    }
  });
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) form[key].push(value);
    else form[key] = [form[key], value];
  } else if (!key.endsWith("[]")) form[key] = value;
  else form[key] = [value];
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key)) return;
  let nestedForm = form;
  const keys = key.split(".", 34);
  if (keys.length > 33) throwNestingLimitExceeded();
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) nestedForm[key2] = value;
    else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS) throwNestingLimitExceeded();
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");
var throwNestingLimitExceeded = /* @__PURE__ */ __name(() => {
  throw new Error("Nesting limit exceeded");
}, "throwNestingLimitExceeded");

// node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") paths.shift();
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath2) => {
  const { groups, path } = extractGroupsFromPath(routePath2);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return {
    groups,
    path
  };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) if (paths[j].includes(mark)) {
      paths[j] = paths[j].replace(mark, groups[i][1]);
      break;
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") return "*";
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [
        cacheKey,
        match2[1],
        new RegExp(`^${match2[2]}(?=/${next})`)
      ] : [
        label,
        match2[1],
        new RegExp(`^${match2[2]}$`)
      ];
      else patternCache[cacheKey] = [
        label,
        match2[1],
        true
      ];
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var decodeURIWithPreservedPercent = /* @__PURE__ */ __name((value) => decodeURI(value.includes("%25") ? value.replace(/%25/g, "%2525") : value), "decodeURIWithPreservedPercent");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      const decoded = tryDecode(path, decodeURIWithPreservedPercent);
      if (/%(?![0-9A-Fa-f]{2})/.test(path)) {
        const rewritten = new URL("http://localhost");
        rewritten.pathname = decoded.replace(/[\\\t\n\r]/g, encodeURIComponent);
        if (tryDecode(rewritten.pathname, decodeURIWithPreservedPercent) !== decoded) return tryDecode(path.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"), decodeURIWithPreservedPercent);
      }
      return decoded;
    } else if (charCode === 63 || charCode === 35) break;
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) sub = mergePath(sub, ...rest);
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) return null;
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) basePath += "/" + segment;
    else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") results.push("/");
        else results.push(basePath);
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else basePath += "/" + segment;
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => str.indexOf("%") !== -1 ? tryDecode(str, decodeURIComponent_) : str, "tryDecodeURIComponent");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (value.indexOf("+") !== -1) value = value.replace(/\+/g, " ");
  return tryDecodeURIComponent(value);
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1) url = url.slice(0, hashIndex);
  let encoded;
  if (!multiple && key && !/[%+&=]/.test(key)) {
    const queryIndex = url.indexOf("?", 8);
    let keyIndex2 = queryIndex;
    if (keyIndex2 === -1) return;
    if (!url.startsWith(key, keyIndex2 + 1)) keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61 || trailingKeyCode === 38 || isNaN(trailingKeyCode)) {
        if (keyIndex2 > queryIndex && /(?:^|&)[^=&]*[%+]/.test(url.slice(queryIndex + 1, keyIndex2))) break;
        if (trailingKeyCode === 61) {
          const valueIndex = keyIndex2 + key.length + 2;
          const endIndex = url.indexOf("&", valueIndex);
          return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
        }
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) return;
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) valueIndex = -1;
    let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex);
    if (encoded) name = _decodeURI(name);
    keyIndex = nextKeyIndex;
    if (name === "") continue;
    let value;
    if (valueIndex === -1) value = "";
    else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) value = _decodeURI(value);
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) results[name] = [];
      results[name].push(value);
    } else results[name] ??= value;
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  /**
  * `.raw` can get the raw Request object.
  *
  * @see {@link https://hono.dev/docs/api/request#raw}
  *
  * @example
  * ```ts
  * // For Cloudflare Workers
  * app.post('/', async (c) => {
  *   const metadata = c.req.raw.cf?.hostMetadata?
  *   ...
  * })
  * ```
  */
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  /**
  * `.path` can get the pathname of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#path}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const pathname = c.req.path // `/about/me`
  * })
  * ```
  */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) decoded[key] = tryDecodeURIComponent(value);
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) return this.raw.headers.get(name) ?? void 0;
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) return cachedBody;
    for (const anyCachedKey in bodyCache) return bodyCache[anyCachedKey].then((body) => {
      if (anyCachedKey === "json") body = JSON.stringify(body);
      const contentType = anyCachedKey === "formData" ? void 0 : raw2.headers.get("content-type");
      return new Response(body, { headers: contentType ? { "Content-Type": contentType } : void 0 })[key]();
    });
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  /**
  * `.json()` can parse Request body of type `application/json`
  *
  * @see {@link https://hono.dev/docs/api/request#json}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.json()
  * })
  * ```
  */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
  * `.text()` can parse Request body of type `text/plain`
  *
  * @see {@link https://hono.dev/docs/api/request#text}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.text()
  * })
  * ```
  */
  text() {
    return this.#cachedBody("text");
  }
  /**
  * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
  *
  * @see {@link https://hono.dev/docs/api/request#arraybuffer}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.arrayBuffer()
  * })
  * ```
  */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
  * `.bytes()` parses the request body as a `Uint8Array`.
  *
  * @see {@link https://hono.dev/docs/api/request#bytes}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.bytes()
  * })
  * ```
  */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
  * Parses the request body as a `Blob`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.blob();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#blob
  */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
  * Parses the request body as `FormData`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.formData();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#formdata
  */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
  * Adds validated data to the request.
  *
  * @param target - The target of the validation.
  * @param data - The validated data to add.
  */
  addValidatedData(target, data) {
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
  * `.url` can get the request url strings.
  *
  * @see {@link https://hono.dev/docs/api/request#url}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const url = c.req.url // `http://localhost:8787/about/me`
  *   ...
  * })
  * ```
  */
  get url() {
    return this.raw.url;
  }
  /**
  * `.method` can get the method name of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#method}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const method = c.req.method // `GET`
  * })
  * ```
  */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
  * `.matchedRoutes` can return a matched route in the handler
  *
  * @deprecated
  *
  * Use matchedRoutes helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#matchedroutes}
  *
  * @example
  * ```ts
  * app.use('*', async function logger(c, next) {
  *   await next()
  *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
  *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
  *     console.log(
  *       method,
  *       ' ',
  *       path,
  *       ' '.repeat(Math.max(10 - path.length, 0)),
  *       name,
  *       i === c.req.routeIndex ? '<- respond from here' : ''
  *     )
  *   })
  * })
  * ```
  */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
  * `.routePath` can retrieve the path registered within the handler
  *
  * @deprecated
  *
  * Use routePath helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#routepath}
  *
  * @example
  * ```ts
  * app.get('/posts/:id', (c) => {
  *   return c.json({ path: c.req.routePath })
  * })
  * ```
  */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) str = str.toString();
    if (str instanceof Promise) str = await str;
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) return Promise.resolve(str);
  if (buffer) buffer[0] += str;
  else buffer = [str];
  const resStr = Promise.all(callbacks.map((c) => c({
    phase,
    buffer,
    context
  }))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks) return raw(await resStr, callbacks);
  else return resStr;
}, "resolveCallback");

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var createResponseInstance = /* @__PURE__ */ __name((body, init) => new Response(body, init), "createResponseInstance");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  /**
  * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
  *
  * @see {@link https://hono.dev/docs/api/context#env}
  *
  * @example
  * ```ts
  * // Environment object for Cloudflare Workers
  * app.get('*', async c => {
  *   const counter = c.env.COUNTER
  * })
  * ```
  */
  env = {};
  #var;
  finalized = false;
  /**
  * `.error` can get the error object from the middleware if the Handler throws an error.
  *
  * @see {@link https://hono.dev/docs/api/context#error}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   await next()
  *   if (c.error) {
  *     // do something...
  *   }
  * })
  * ```
  */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
  * Creates an instance of the Context class.
  *
  * @param req - The Request object.
  * @param options - Optional configuration options for the context.
  */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
  * `.req` is the instance of {@link HonoRequest}.
  */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#event}
  * The FetchEvent associated with the current request.
  *
  * @throws Will throw an error if the context does not have a FetchEvent.
  */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no FetchEvent");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#executionctx}
  * The ExecutionContext associated with the current request.
  *
  * @throws Will throw an error if the context does not have an ExecutionContext.
  */
  get executionCtx() {
    if (this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no ExecutionContext");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#res}
  * The Response object for the current request.
  */
  get res() {
    return this.#res ||= createResponseInstance(null, { headers: this.#preparedHeaders ??= new Headers() });
  }
  /**
  * Sets the Response object for the current request.
  *
  * @param _res - The Response object to set.
  */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") continue;
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) _res.headers.append("set-cookie", cookie);
        } else _res.headers.set(k, v);
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
  * `.render()` can create a response within a layout.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   return c.render('Hello!')
  * })
  * ```
  */
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  /**
  * Sets the layout for the response.
  *
  * @param layout - The layout to set.
  * @returns The layout function.
  */
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  /**
  * Gets the current layout for the response.
  *
  * @returns The current layout function.
  */
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  /**
  * `.setRenderer()` can set the layout in the custom middleware.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```tsx
  * app.use('*', async (c, next) => {
  *   c.setRenderer((content) => {
  *     return c.html(
  *       <html>
  *         <body>
  *           <p>{content}</p>
  *         </body>
  *       </html>
  *     )
  *   })
  *   await next()
  * })
  * ```
  */
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  /**
  * `.header()` can set headers.
  *
  * @see {@link https://hono.dev/docs/api/context#header}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *
  *   // Append multiple headers using the append option (e.g. Vary)
  *   c.header('Vary', 'Accept-Encoding', { append: true })
  *   c.header('Vary', 'User-Agent', { append: true })
  *
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized && !this.#res.bodyUsed) this.#res = createResponseInstance(this.#res.body, this.#res);
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) headers.delete(name);
    else if (options?.append) headers.append(name, value);
    else headers.set(name, value);
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  /**
  * `.set()` can set the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   c.set('message', 'Hono is hot!!')
  *   await next()
  * })
  * ```
  */
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  /**
  * `.get()` can use the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   const message = c.get('message')
  *   return c.text(`The message is "${message}"`)
  * })
  * ```
  */
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  /**
  * `.var` can access the value of a variable.
  *
  * @see {@link https://hono.dev/docs/api/context#var}
  *
  * @example
  * ```ts
  * const result = c.var.client.oneMethod()
  * ```
  */
  get var() {
    if (!this.#var) return {};
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers)) if (key === "set-cookie") responseHeaders.append(key, value);
      else responseHeaders.set(key, value);
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) if (++count > 1 || typeof headers[k] !== "string") {
          responseHeaders = new Headers();
          break;
        }
      }
      if (responseHeaders) for (const k in headers) {
        const v = headers[k];
        if (typeof v === "string") responseHeaders.set(k, v);
        else {
          responseHeaders.delete(k);
          for (const v2 of v) responseHeaders.append(k, v2);
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  /**
  * `.body()` can return the HTTP response.
  * You can set headers with `.header()` and set HTTP status code with `.status`.
  * This can also be set in `.text()`, `.json()` and so on.
  *
  * @see {@link https://hono.dev/docs/api/context#body}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *   // Set HTTP status code
  *   c.status(201)
  *
  *   // Return the response body
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  /**
  * `.text()` can render text as `Content-Type:text/plain`.
  *
  * @see {@link https://hono.dev/docs/api/context#text}
  *
  * @example
  * ```ts
  * app.get('/say', (c) => {
  *   return c.text('Hello!')
  * })
  * ```
  */
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
  }, "text");
  /**
  * `.json()` can render JSON as `Content-Type:application/json`.
  *
  * @see {@link https://hono.dev/docs/api/context#json}
  *
  * @example
  * ```ts
  * app.get('/api', (c) => {
  *   return c.json({ message: 'Hello!' })
  * })
  * ```
  */
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  /**
  * `.redirect()` can Redirect, default status code is 302.
  *
  * @see {@link https://hono.dev/docs/api/context#redirect}
  *
  * @example
  * ```ts
  * app.get('/redirect', (c) => {
  *   return c.redirect('/')
  * })
  * app.get('/redirect-permanently', (c) => {
  *   return c.redirect('/', 301)
  * })
  * ```
  */
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  /**
  * `.notFound()` can return the Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/context#notfound}
  *
  * @example
  * ```ts
  * app.get('/notfound', (c) => {
  *   return c.notFound()
  * })
  * ```
  */
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else handler = i === middleware.length && next || void 0;
      if (handler) try {
        res = await handler(context, () => dispatch(i + 1));
      } catch (err) {
        if (err instanceof Error && onError) {
          context.error = err;
          res = await onError(err, context);
          isError = true;
        } else throw err;
      }
      else if (context.finalized === false && onNotFound) res = await onNotFound(context);
      if (res && (context.finalized === false || isError)) context.res = res;
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/hono/dist/helper/route/index.js
var matchedRoutes = /* @__PURE__ */ __name((c) => c.req[GET_MATCH_RESULT][0].map(([[, route]]) => route), "matchedRoutes");
var routePath = /* @__PURE__ */ __name((c, index) => matchedRoutes(c).at(index ?? c.req.routeIndex)?.path ?? "", "routePath");

// node_modules/hono/dist/router.js
var METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "options",
  "patch",
  "query"
];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/utils/mount.js
var countTrailingSlashes = /* @__PURE__ */ __name((path) => {
  let index = path.length;
  while (index > 0 && path.charCodeAt(index - 1) === 47) index--;
  return path.length - index;
}, "countTrailingSlashes");
var getPathPrefixLength = /* @__PURE__ */ __name((c, pathPrefix, routePath2) => {
  if (!/[:*]/.test(pathPrefix)) return pathPrefix.length;
  const path = c.req.path;
  const matchResult = c.req[GET_MATCH_RESULT];
  const paramNames = /* @__PURE__ */ new Set();
  let length = 0;
  for (const part of splitRoutingPath(pathPrefix)) {
    if (part[0] === ":" && part.endsWith("}?")) throw new Error(`mount(): Optional regular expression parameters are not supported in "${routePath2}".`);
    const pattern = getPattern(part);
    if (pattern && pattern !== "*") {
      const name = pattern[1];
      if (paramNames.has(name)) throw new Error(`mount(): Duplicate path parameter "${name}" in "${routePath2}".`);
      paramNames.add(name);
    }
    if (pattern && pattern !== "*" && pattern[2] !== true) {
      const value = matchResult.length === 2 ? matchResult[1][matchResult[0][c.req.routeIndex][1][pattern[1]]] : matchResult[0][c.req.routeIndex][1][pattern[1]];
      length += value.length + 1;
    } else if (pattern || part.endsWith("*")) {
      const end = path.indexOf("/", length + 1);
      length = end === -1 ? path.length : end;
    } else length += part.length + 1;
  }
  return length;
}, "getPathPrefixLength");
var createMountedRequest = /* @__PURE__ */ __name((c, pathPrefix, routePath2) => {
  if (/[^/]\*$/.test(routePath2)) throw new Error(`mount(): Wildcard must follow "/" in "${routePath2}".`);
  const prefixLength = getPathPrefixLength(c, pathPrefix, routePath2);
  const path = c.req.path.slice(prefixLength) || "/";
  if (prefixLength > c.req.path.length || path[0] !== "/" || /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(path)) throw new HTTPException(400, { message: "Invalid mounted path" });
  const rawUrl = c.req.raw.url;
  if (/^[^/?#]*\/\/[^/?#\\]*[?#\\]/.test(rawUrl)) throw new HTTPException(400, { message: "Invalid mounted path" });
  const rawPathEnd = rawUrl.search(/[?#]/);
  const rawTrailingSlashes = countTrailingSlashes(rawPathEnd === -1 ? rawUrl : rawUrl.slice(0, rawPathEnd));
  if (rawTrailingSlashes > 1 && countTrailingSlashes(c.req.path) === rawTrailingSlashes - 1) throw new HTTPException(400, { message: "Invalid mounted path" });
  const url = new URL(rawUrl);
  url.pathname = path.replace(/[\\\t\n\r]/g, encodeURIComponent);
  if (path.includes("%")) {
  }
  return new Request(url, c.req.raw);
}, "createMountedRequest");

// node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class Hono2 {
  static {
    __name(this, "Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    [...METHODS, "all"].forEach((method) => {
      this[method] = (args1, ...args) => {
        const methodName = method.toUpperCase();
        if (typeof args1 === "string") this.#path = args1;
        else this.#addRoute(methodName, this.#path, args1);
        args.forEach((handler) => {
          this.#addRoute(methodName, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          const methodName = m.toUpperCase();
          for (const handler of handlers) this.#addRoute(methodName, this.#path, handler);
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") this.#path = arg1;
      else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute("ALL", this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new Hono2({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  /**
  * `.route()` allows grouping other Hono instance in routes.
  *
  * @see {@link https://hono.dev/docs/api/routing#grouping}
  *
  * @param {string} path - base Path
  * @param {Hono} app - other Hono instance
  * @returns {Hono} routed Hono instance
  *
  * @example
  * ```ts
  * const app = new Hono()
  * const app2 = new Hono()
  *
  * app2.get("/user", (c) => c.text("user"))
  * app.route("/api", app2) // GET /api/user
  * ```
  */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) handler = r.handler;
      else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler, r.basePath);
    });
    return this;
  }
  /**
  * `.basePath()` allows base paths to be specified.
  *
  * @see {@link https://hono.dev/docs/api/routing#base-path}
  *
  * @param {string} path - base Path
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * const api = new Hono().basePath('/api')
  * ```
  */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
  * `.onError()` handles an error and returns a customized Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#error-handling}
  *
  * @param {ErrorHandler} handler - request Handler for error
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.onError((err, c) => {
  *   console.error(`${err}`)
  *   return c.text('Custom Error Message', 500)
  * })
  * ```
  */
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  /**
  * `.notFound()` allows you to customize a Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#not-found}
  *
  * @param {NotFoundHandler} handler - request handler for not-found
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.notFound((c) => {
  *   return c.text('Custom 404 Message', 404)
  * })
  * ```
  */
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  /**
  * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
  *
  * @deprecated Use `mount()` from `hono/mount` instead. `.mount()` will be removed in v5.
  *
  * @see {@link https://hono.dev/docs/api/hono#mount}
  *
  * @param {string} path - base Path
  * @param {Function} applicationHandler - other Request Handler
  * @param {MountOptions} [options] - options of `.mount()`
  * @returns {Hono} mounted Hono instance
  * @throws {Error} If automatic request rewriting encounters duplicate path parameter names or an optional regular expression parameter.
  * @throws {HTTPException} With status 400 if automatic request rewriting cannot safely preserve the routed path.
  *
  * @example
  * ```ts
  * import { Router as IttyRouter } from 'itty-router'
  * import { Hono } from 'hono'
  * // Create itty-router application
  * const ittyRouter = IttyRouter()
  * // GET /itty-router/hello
  * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
  *
  * const app = new Hono()
  * app.mount('/itty-router', ittyRouter.handle)
  * ```
  *
  * @example
  * ```ts
  * const app = new Hono()
  * // Send the request to another application without modification.
  * app.mount('/app', anotherApp, {
  *   replaceRequest: (req) => req,
  * })
  * ```
  */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") optionHandler = options;
      else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        else replaceRequest = options.replaceRequest;
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    const defaultReplaceRequest = /* @__PURE__ */ __name((c) => {
      const mountedRoutePath = routePath(c);
      return createMountedRequest(c, mountedRoutePath.replace(/\/?\*$/, ""), mountedRoutePath);
    }, "defaultReplaceRequest");
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest ? replaceRequest(c.req.raw) : defaultReplaceRequest(c), ...getOptions(c));
      if (res) return res;
      await next();
    }, "handler");
    this.#addRoute("ALL", mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler, baseRoutePath) {
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler
    };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) return this.errorHandler(err, c);
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
  * `.fetch()` will be entry point of your app.
  *
  * @see {@link https://hono.dev/docs/api/hono#fetch}
  *
  * @param {Request} request - request Object of request
  * @param {Env} env - env Object
  * @param {ExecutionContext} executionCtx - context of execution
  * @returns {Response | Promise<Response>} response of request
  *
  */
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  /**
  * `.request()` is a useful method for testing.
  * You can pass a URL or pathname to send a GET request.
  * app will return a Response object.
  * ```ts
  * test('GET /hello is ok', async () => {
  *   const res = await app.request('/hello')
  *   expect(res.status).toBe(200)
  * })
  * ```
  * @see https://hono.dev/docs/api/hono#request
  */
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    input = input.toString();
    return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
  }, "request");
  /**
  * `.fire()` automatically adds a global fetch event listener.
  * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
  * @deprecated
  * Use `fire` from `hono/service-worker` instead.
  * ```ts
  * import { Hono } from 'hono'
  * import { fire } from 'hono/service-worker'
  *
  * const app = new Hono()
  * // ...
  * fire(app)
  * ```
  * @see https://hono.dev/docs/api/hono#fire
  * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
  * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
  */
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// node_modules/hono/dist/router/utils.js
var createNullObject = /* @__PURE__ */ __name(() => /* @__PURE__ */ Object.create(null), "createNullObject");

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name(((method2, path2) => {
    const matcher = matchers[method2] || matchers["ALL"];
    const staticMatch = matcher[2][path2];
    if (staticMatch) return staticMatch;
    const match3 = path2.match(matcher[0]);
    if (!match3) return [[], emptyParam];
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }), "match");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = "[^]*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/[^]*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = /* @__PURE__ */ new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) return b.length === 1 ? a < b ? -1 : 1 : -1;
  if (b.length === 1) return 1;
  if (a === "[^]*" || a === "(?:|/[^]*)") return b === "[^]*" ? -1 : 1;
  else if (b === "[^]*" || b === "(?:|/[^]*)") return -1;
  if (a === "[^/]+") return 1;
  else if (b === "[^/]+") return -1;
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class Node2 {
  static {
    __name(this, "Node");
  }
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens, index, paramMap, context, keys) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? [
        "",
        "",
        ONLY_WILDCARD_REG_EXP_STR
      ] : [
        "",
        "",
        LABEL_REG_EXP_STR
      ] : null : token === "/*" ? [
        "",
        "",
        TAIL_WILDCARD_REG_EXP_STR
      ] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || "[^/]+";
        if (name && pattern[2]) {
          if (new RegExp(regexpStr).test("")) throw PATH_ERROR;
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr)) throw PATH_ERROR;
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) throw PATH_ERROR;
        }
        keys.push(regexpStr);
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== "[^]*" && regexpStr !== "(?:|/[^]*)") {
            for (const k in node.#children) if ((regexpStr.length > 1 || k.length > 1) && k !== "[^]*" && k !== "(?:|/[^]*)") throw PATH_ERROR;
          }
          nextNode = node.#children[regexpStr] = new Node2();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        keys.push(token);
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) if (k.length > 1 && k !== "[^]*" && k !== "(?:|/[^]*)") throw PATH_ERROR;
          nextNode = node.#children[token] = new Node2();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) throw PATH_ERROR;
    node.#index = index;
  }
  buildRegExpStr() {
    const strList = Object.keys(this.#children).sort(compareKey).map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) strList.unshift(`#${this.#index}`);
    if (strList.length === 0) return "";
    if (strList.length === 1) return strList[0];
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  paths = createNullObject();
  insert(path, isStatic) {
    const keys = [];
    if (isStatic) {
      this.#root.insert(path.split(""), -1, [], this.#context, keys);
      this.paths[path] = [
        -1,
        [],
        keys
      ];
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{(?:\{[\d,]+\}|[^}])+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) break;
    }
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./gs) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) if (tokens[j].indexOf(mark) !== -1) {
        tokens[j] = tokens[j].replace(mark, groups[i][1]);
        break;
      }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, keys);
    this.paths[path] = [
      this.#index++,
      paramAssoc,
      keys
    ];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") return [
      /^$/,
      [],
      []
    ];
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [
      new RegExp(`^${regexp}`),
      indexReplacementMap,
      paramReplacementMap
    ];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
function endsWithWildcard(keys) {
  const tail = keys[keys.length - 1];
  return tail === "[^]*" || tail === "(?:|/[^]*)";
}
__name(endsWithWildcard, "endsWithWildcard");
function covers(wildcard, target) {
  const last = wildcard.length - 1;
  for (let i = 0; i < last; i++) if (wildcard[i] !== target[i]) return false;
  return wildcard[last] === "[^]*" || target.length === last || target[last] === "/";
}
__name(covers, "covers");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #handlers;
  #tries;
  constructor() {
    this.#handlers = { ["ALL"]: [] };
    this.#tries = { ["ALL"]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler) {
    const handlers = this.#handlers;
    if (!handlers) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    const tries = this.#tries;
    if (!handlers[method]) {
      tries[method] = new Trie();
      handlers[method] = [...handlers["ALL"]];
      for (const p in tries["ALL"].paths) this.#insertPath(method, p);
    }
    if (path === "/*") path = "*";
    const methods = method === "ALL" ? Object.keys(handlers) : [method];
    const paths = checkOptionalParameter(path) || [path];
    for (const path2 of paths) for (const m of methods) {
      if (!tries[m].paths[path2]) this.#insertPath(m, path2);
      handlers[m].push([handler, path2]);
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#handlers)) matchers[method] = this.#buildMatcher(method);
    this.#handlers = this.#tries = void 0;
    return matchers;
  }
  #buildMatcher(method) {
    const handlers = this.#handlers[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    const own = createNullObject();
    const entries = handlers.map(([h, p], i) => {
      (own[p] ??= []).push(i);
      return [h, trie.paths[p][1].reduceRight((map, [key, varIndex]) => {
        map[key] = paramReplacementMap[varIndex];
        return map;
      }, createNullObject())];
    });
    const wildcards = Object.keys(own).filter((p) => endsWithWildcard(trie.paths[p][2]));
    for (const path in trie.paths) {
      const [index, , keys] = trie.paths[path];
      const indexes = [...own[path]];
      for (const p of wildcards) if (p !== path && covers(trie.paths[p][2], keys)) indexes.push(...own[p]);
      const data = indexes.sort((a, b) => a - b).map((i) => entries[i]);
      if (index === -1) {
        const last = Math.max(-1, ...data.flatMap(([, map]) => Object.values(map)));
        staticMap[path] = [data, last === -1 ? emptyParam : path.match(regexp).slice(0, last + 1)];
      } else handlerData[index] = data;
    }
    return [
      regexp,
      indexReplacementMap.map((i) => handlerData[i]),
      staticMap
    ];
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    this.#routes.push([
      method,
      path,
      handler
    ]);
  }
  match(method, path) {
    if (!this.#routes) throw new Error("Fatal error");
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) router.add(...routes[i2]);
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) continue;
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) throw new Error("Fatal error");
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) throw new Error("No active router has been determined yet.");
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = createNullObject();
var order = 0;
var Node3 = class Node4 {
  static {
    __name(this, "Node");
  }
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path, handler) {
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key] ||= new Node4();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam) possibleKeys.add(pattern[1]);
    }
    curNode.#methods.push({ [method]: {
      handler,
      possibleKeys: [...possibleKeys],
      score: ++order
    } });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m["ALL"];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key = handlerSet.possibleKeys[i2];
          handlerSet.params[key] = params?.[key] && !i2 ? params[key] : nodeParams[key] ?? params?.[key];
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    let curNodes = [this];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else tempNodes.push(nextNode);
        }
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true) continue;
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              if (!Object.hasOwn(params, name)) params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, node.#params, params);
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                (curNodesQueue[componentCount] ||= []).push(child);
                break;
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            if (!Object.hasOwn(params, name)) params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, params, node.#params);
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets[1]) handlerSets.sort((a, b) => {
      return a.score - b.score;
    });
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node = new Node3();
  add(method, path, handler) {
    for (const result of checkOptionalParameter(path) || [path]) this.#node.insert(method, result, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono3 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  /**
  * Creates an instance of the Hono class.
  *
  * @param options - Optional configuration options for the Hono instance.
  */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
  }
};

// node_modules/hono/dist/utils/cookie.js
var validCookieNameRegEx = /^[\w!#$%&'*.^`|~+-]+$/;
var relaxedCookieNameRegEx = /^[!#-:<>-[\]-~]+$/;
var validCookieValueRegEx = /^[ !#-:<-[\]-~]*$/;
var trimCookieWhitespace = /* @__PURE__ */ __name((value) => {
  let start = 0;
  let end = value.length;
  while (start < end) {
    const charCode = value.charCodeAt(start);
    if (charCode !== 32 && charCode !== 9) break;
    start++;
  }
  while (end > start) {
    const charCode = value.charCodeAt(end - 1);
    if (charCode !== 32 && charCode !== 9) break;
    end--;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}, "trimCookieWhitespace");
var parse = /* @__PURE__ */ __name((cookie, name) => {
  if (name && cookie.indexOf(name) === -1) return {};
  const pairs = cookie.split(";");
  const parsedCookie = /* @__PURE__ */ Object.create(null);
  for (const pairStr of pairs) {
    const valueStartPos = pairStr.indexOf("=");
    if (valueStartPos === -1) continue;
    const cookieName = trimCookieWhitespace(pairStr.substring(0, valueStartPos));
    if (name && name !== cookieName || !relaxedCookieNameRegEx.test(cookieName) || cookieName in parsedCookie) continue;
    let cookieValue = trimCookieWhitespace(pairStr.substring(valueStartPos + 1));
    if (cookieValue.startsWith('"') && cookieValue.endsWith('"')) cookieValue = cookieValue.slice(1, -1);
    if (validCookieValueRegEx.test(cookieValue)) {
      parsedCookie[cookieName] = tryDecodeURIComponent(cookieValue);
      if (name) break;
    }
  }
  return parsedCookie;
}, "parse");
var _serialize = /* @__PURE__ */ __name((name, value, opt = {}) => {
  if (!validCookieNameRegEx.test(name)) throw new Error("Invalid cookie name");
  let cookie = `${name}=${value}`;
  if (/^__secure-/i.test(name) && !opt.secure) throw new Error("__Secure- Cookie must have Secure attributes");
  if (/^__host-/i.test(name)) {
    if (!opt.secure) throw new Error("__Host- Cookie must have Secure attributes");
    if (opt.path !== "/") throw new Error('__Host- Cookie must have Path attributes with "/"');
    if (opt.domain) throw new Error("__Host- Cookie must not have Domain attributes");
  }
  for (const key of [
    "domain",
    "path",
    "sameSite",
    "priority"
  ]) if (opt[key] && /[;\r\n]/.test(opt[key])) throw new Error(`${key} must not contain ";", "\\r", or "\\n"`);
  if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
    if (opt.maxAge > 3456e4) throw new Error("Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration.");
    cookie += `; Max-Age=${opt.maxAge | 0}`;
  }
  if (opt.domain && opt.prefix !== "host") cookie += `; Domain=${opt.domain}`;
  if (opt.path) cookie += `; Path=${opt.path}`;
  if (opt.expires) {
    if (opt.expires.getTime() - Date.now() > 3456e7) throw new Error("Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future.");
    cookie += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly) cookie += "; HttpOnly";
  if (opt.secure) cookie += "; Secure";
  if (opt.sameSite) cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
  if (opt.priority) cookie += `; Priority=${opt.priority.charAt(0).toUpperCase() + opt.priority.slice(1)}`;
  if (opt.partitioned) {
    if (!opt.secure) throw new Error("Partitioned Cookie must have Secure attributes");
    cookie += "; Partitioned";
  }
  return cookie;
}, "_serialize");
var serialize = /* @__PURE__ */ __name((name, value, opt) => {
  value = encodeURIComponent(value);
  return _serialize(name, value, opt);
}, "serialize");

// node_modules/hono/dist/helper/cookie/index.js
var getCookie = /* @__PURE__ */ __name((c, key, prefix) => {
  const cookie = c.req.raw.headers.get("Cookie");
  if (typeof key === "string") {
    if (!cookie) return;
    let finalKey = key;
    if (prefix === "secure") finalKey = "__Secure-" + key;
    else if (prefix === "host") finalKey = "__Host-" + key;
    return parse(cookie, finalKey)[finalKey];
  }
  if (!cookie) return {};
  return parse(cookie);
}, "getCookie");
var generateCookie = /* @__PURE__ */ __name((name, value, opt) => {
  let cookie;
  if (opt?.prefix === "secure") cookie = serialize("__Secure-" + name, value, {
    path: "/",
    ...opt,
    secure: true
  });
  else if (opt?.prefix === "host") cookie = serialize("__Host-" + name, value, {
    ...opt,
    path: "/",
    secure: true,
    domain: void 0
  });
  else cookie = serialize(name, value, {
    path: "/",
    ...opt
  });
  return cookie;
}, "generateCookie");
var setCookie = /* @__PURE__ */ __name((c, name, value, opt) => {
  const cookie = generateCookie(name, value, opt);
  c.header("Set-Cookie", cookie, { append: true });
}, "setCookie");
var deleteCookie = /* @__PURE__ */ __name((c, name, opt) => {
  const deletedCookie = getCookie(c, name, opt?.prefix);
  setCookie(c, name, "", {
    ...opt,
    maxAge: 0
  });
  return deletedCookie;
}, "deleteCookie");

// src/index.ts
var app = new Hono3();
var SESSION_COOKIE = "cloudchat_session";
var SESSION_SECONDS = 60 * 60 * 24 * 14;
var jsonError = /* @__PURE__ */ __name((c, status, message) => c.json({ error: message }, status), "jsonError");
var uuid = /* @__PURE__ */ __name(() => crypto.randomUUID(), "uuid");
var hex = /* @__PURE__ */ __name((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""), "hex");
async function sha2562(value) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
__name(sha2562, "sha256");
async function rateLimitBlocked(c, key, limit, windowSeconds) {
  const keyHash = await sha2562(key);
  const now = Math.floor(Date.now() / 1e3);
  const row = await c.env.DB.prepare(
    "SELECT window_start,attempts FROM auth_rate_limits WHERE key_hash=?"
  ).bind(keyHash).first();
  if (!row || Number(row.window_start) + windowSeconds <= now) return false;
  return Number(row.attempts) >= limit;
}
__name(rateLimitBlocked, "rateLimitBlocked");
async function recordRateLimit(c, key, windowSeconds) {
  const keyHash = await sha2562(key);
  const now = Math.floor(Date.now() / 1e3);
  await c.env.DB.prepare(
    `INSERT INTO auth_rate_limits(key_hash,window_start,attempts,updated_at)
     VALUES(?,?,1,?)
     ON CONFLICT(key_hash) DO UPDATE SET
       attempts=CASE
         WHEN auth_rate_limits.window_start + ? <= excluded.updated_at THEN 1
         ELSE auth_rate_limits.attempts + 1
       END,
       window_start=CASE
         WHEN auth_rate_limits.window_start + ? <= excluded.updated_at THEN excluded.updated_at
         ELSE auth_rate_limits.window_start
       END,
       updated_at=excluded.updated_at`
  ).bind(keyHash, now, now, windowSeconds, windowSeconds).run();
}
__name(recordRateLimit, "recordRateLimit");
async function clearRateLimit(c, key) {
  const keyHash = await sha2562(key);
  await c.env.DB.prepare("DELETE FROM auth_rate_limits WHERE key_hash=?").bind(keyHash).run();
}
__name(clearRateLimit, "clearRateLimit");
function clientIp(c) {
  return c.req.header("cf-connecting-ip") || "unknown";
}
__name(clientIp, "clientIp");
async function makePassword(password, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/.{1,2}/g).map((x) => parseInt(x, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" }, key, 256);
  return { salt: hex(salt.buffer), hash: hex(bits) };
}
__name(makePassword, "makePassword");
async function verifyPassword(password, salt, expected) {
  const actual = await makePassword(password, salt);
  return actual.hash === expected;
}
__name(verifyPassword, "verifyPassword");
async function currentUser(c) {
  const raw2 = getCookie(c, SESSION_COOKIE);
  if (!raw2) return null;
  const hash = await sha2562(raw2);
  const row = await c.env.DB.prepare(
    `SELECT u.id,u.username,u.display_name,u.role,u.status
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.id_hash=? AND s.expires_at>?`
  ).bind(hash, Math.floor(Date.now() / 1e3)).first();
  if (!row || row.status !== "active") return null;
  return row;
}
__name(currentUser, "currentUser");
app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return next();
  }
  const origin = c.req.header("Origin");
  const fetchSite = c.req.header("Sec-Fetch-Site");
  if (origin) {
    let originUrl;
    let requestUrl;
    try {
      originUrl = new URL(origin);
      requestUrl = new URL(c.req.url);
    } catch {
      return jsonError(c, 403, "??????");
    }
    if (originUrl.origin !== requestUrl.origin) {
      return jsonError(c, 403, "????????");
    }
  } else if (fetchSite === "cross-site") {
    return jsonError(c, 403, "??????");
  }
  return next();
});
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path === "/api/auth/login" || c.req.path === "/api/auth/logout" || c.req.path === "/api/auth/register") return next();
  const user = await currentUser(c);
  if (!user) return jsonError(c, 401, "\u8BF7\u5148\u767B\u5F55");
  c.set("user", user);
  return next();
});
function requireAdmin(c) {
  if (c.get("user")?.role !== "admin") return false;
  return true;
}
__name(requireAdmin, "requireAdmin");
app.get("/api/health", (c) => c.json({ ok: true, service: "CloudChat", version: "0.1.0" }));
app.post("/api/setup/admin", (c) => {
  return jsonError(c, 410, "Administrator setup is disabled.");
});
app.post("/api/auth/register", async (c) => {
  const ip = clientIp(c);
  const limitKey = `register:${ip}`;
  if (await rateLimitBlocked(c, limitKey, 5, 3600)) {
    return jsonError(c, 429, "\u6CE8\u518C\u5C1D\u8BD5\u6B21\u6570\u8FC7\u591A\uFF0C\u8BF7\u4E00\u5C0F\u65F6\u540E\u518D\u8BD5");
  }
  await recordRateLimit(c, limitKey, 3600);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.invite || "").trim();
  const username = String(body.username || "").trim().toLowerCase();
  const displayName = String(body.displayName || username).trim();
  if (!token || !/^[a-zA-Z0-9_]{3,24}$/.test(username) || typeof body.password !== "string" || body.password.length < 10) {
    return jsonError(c, 400, "\u8BF7\u68C0\u67E5\u9080\u8BF7\u7801\u3001\u7528\u6237\u540D\u548C\u5BC6\u7801\uFF08\u5BC6\u7801\u81F3\u5C11 10 \u4F4D\uFF09");
  }
  const tokenHash = await sha2562(token);
  const now = Math.floor(Date.now() / 1e3);
  const invite = await c.env.DB.prepare(
    "SELECT id FROM invites WHERE token_hash=? AND used_by IS NULL AND expires_at>?"
  ).bind(tokenHash, now).first();
  if (!invite) {
    return jsonError(c, 400, "\u9080\u8BF7\u7801\u65E0\u6548\u3001\u5DF2\u4F7F\u7528\u6216\u5DF2\u8FC7\u671F");
  }
  const { salt, hash } = await makePassword(body.password);
  const id = uuid();
  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users(id, username, display_name, password_hash, password_salt)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM invites
           WHERE id = ? AND used_by IS NULL AND expires_at > ?
         )`
      ).bind(id, username, displayName, hash, salt, invite.id, now),
      c.env.DB.prepare(
        `UPDATE invites
         SET used_by = ?
         WHERE id = ? AND used_by IS NULL AND expires_at > ?
           AND EXISTS (SELECT 1 FROM users WHERE id = ?)`
      ).bind(id, invite.id, now, id),
      c.env.DB.prepare(
        `DELETE FROM users
         WHERE id = ?
           AND NOT EXISTS (
             SELECT 1 FROM invites WHERE id = ? AND used_by = ?
           )`
      ).bind(id, invite.id, id)
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
      return jsonError(c, 409, "\u6CE8\u518C\u5931\u8D25\uFF0C\u7528\u6237\u540D\u53EF\u80FD\u5DF2\u5B58\u5728\uFF0C\u6216\u9080\u8BF7\u7801\u5DF2\u88AB\u4F7F\u7528");
    }
  } catch (error) {
    console.error("Registration failed:", error);
    return jsonError(c, 409, "\u6CE8\u518C\u5931\u8D25\uFF0C\u7528\u6237\u540D\u53EF\u80FD\u5DF2\u5B58\u5728\uFF0C\u8BF7\u68C0\u67E5\u540E\u91CD\u8BD5");
  }
  return c.json({
    ok: true,
    message: "\u6CE8\u518C\u6210\u529F\uFF0C\u8BF7\u767B\u5F55"
  });
});
app.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase();
  const ip = clientIp(c);
  const accountKey = `login-account:${ip}:${username}`;
  const ipKey = `login-ip:${ip}`;
  if (await rateLimitBlocked(c, accountKey, 8, 900) || await rateLimitBlocked(c, ipKey, 30, 900)) {
    return jsonError(c, 429, "\u767B\u5F55\u5C1D\u8BD5\u6B21\u6570\u8FC7\u591A\uFF0C\u8BF7 15 \u5206\u949F\u540E\u518D\u8BD5");
  }
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE username=?").bind(username).first();
  if (!row || row.status !== "active" || !await verifyPassword(String(body.password || ""), row.password_salt, row.password_hash)) {
    await recordRateLimit(c, accountKey, 900);
    await recordRateLimit(c, ipKey, 900);
    return jsonError(c, 401, "\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165");
  }
  await clearRateLimit(c, accountKey);
  const session = `${uuid()}${uuid().replaceAll("-", "")}`;
  await c.env.DB.prepare("INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)").bind(await sha2562(session), row.id, Math.floor(Date.now() / 1e3) + SESSION_SECONDS).run();
  setCookie(c, SESSION_COOKIE, session, { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: SESSION_SECONDS });
  return c.json({ ok: true, user: { id: row.id, username: row.username, displayName: row.display_name, role: row.role } });
});
app.post("/api/auth/logout", async (c) => {
  const raw2 = getCookie(c, SESSION_COOKIE);
  if (raw2) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash=?").bind(await sha2562(raw2)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
app.patch("/api/me/profile", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const displayName = String(body.displayName ?? "").trim();
  if (!displayName || displayName.length > 32) {
    return jsonError(c, 400, "\u6635\u79F0\u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u4E14\u4E0D\u80FD\u8D85\u8FC732\u4E2A\u5B57\u7B26");
  }
  await c.env.DB.prepare(
    "UPDATE users SET display_name=? WHERE id=? AND status='active'"
  ).bind(displayName, user.id).run();
  return c.json({ ok: true, displayName });
});
app.post("/api/me/avatar", async (c) => {
  const user = c.get("user");
  let body;
  try {
    body = await c.req.parseBody();
  } catch {
    return jsonError(c, 400, "\u65E0\u6CD5\u8BFB\u53D6\u5934\u50CF\u6587\u4EF6");
  }
  const file = body.avatar;
  if (!(file instanceof File)) {
    return jsonError(c, 400, "\u8BF7\u9009\u62E9\u5934\u50CF\u6587\u4EF6");
  }
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) {
    return jsonError(c, 400, "\u5934\u50CF\u5927\u5C0F\u5FC5\u987B\u57282MB\u4EE5\u5185");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let mimeType = "";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mimeType = "image/jpeg";
  } else if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    mimeType = "image/png";
  } else if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
    mimeType = "image/webp";
  } else {
    return jsonError(c, 400, "\u53EA\u652F\u6301\u771F\u5B9E\u7684 JPG\u3001PNG\u3001WebP \u56FE\u7247");
  }
  const key = "avatars/" + user.id + "/" + crypto.randomUUID();
  try {
    const old = await c.env.DB.prepare(
      "SELECT avatar_url FROM users WHERE id=?"
    ).bind(user.id).first();
    await c.env.CHAT_IMAGES.put(key, bytes, {
      httpMetadata: { contentType: mimeType }
    });
    await c.env.DB.prepare(
      "UPDATE users SET avatar_url=? WHERE id=?"
    ).bind(key, user.id).run();
    if (old?.avatar_url && String(old.avatar_url).startsWith("avatars/")) {
      try {
        await c.env.CHAT_IMAGES.delete(old.avatar_url);
      } catch (error) {
        console.warn("Old avatar cleanup failed:", error);
      }
    }
    return c.json({ ok: true });
  } catch (error) {
    console.error("Avatar upload failed:", error);
    try {
      await c.env.CHAT_IMAGES.delete(key);
    } catch {
    }
    return jsonError(c, 500, "\u5934\u50CF\u4FDD\u5B58\u5931\u8D25");
  }
});
app.get("/api/me/avatar", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT avatar_url FROM users WHERE id=?"
  ).bind(user.id).first();
  if (!row?.avatar_url) return jsonError(c, 404, "\u5C1A\u672A\u8BBE\u7F6E\u5934\u50CF");
  const object = await c.env.CHAT_IMAGES.get(row.avatar_url);
  if (!object) return jsonError(c, 404, "\u5934\u50CF\u6587\u4EF6\u4E0D\u5B58\u5728");
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
});
app.get("/api/users/:id/avatar", async (c) => {
  const user = c.get("user");
  const targetId = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT avatar_url FROM users
     WHERE id=? AND status='active'
       AND (
         id=?
         OR EXISTS (
           SELECT 1 FROM friendships f
           WHERE f.user_id=? AND f.friend_id=users.id
             AND f.status='accepted'
             AND EXISTS (
               SELECT 1 FROM friendships r
               WHERE r.user_id=users.id AND r.friend_id=?
                 AND r.status='accepted'
             )
         )
       )`
  ).bind(targetId, user.id, user.id, user.id).first();
  if (!row?.avatar_url) return jsonError(c, 404, "\u5934\u50CF\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u67E5\u770B");
  const object = await c.env.CHAT_IMAGES.get(row.avatar_url);
  if (!object) return jsonError(c, 404, "\u5934\u50CF\u6587\u4EF6\u4E0D\u5B58\u5728");
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
});
app.get("/api/me", async (c) => {
  const u = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT avatar_url FROM users WHERE id=?"
  ).bind(u.id).first();
  return c.json({
    user: {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      role: u.role,
      avatarUrl: row?.avatar_url || null
    }
  });
});
app.post("/api/admin/invites", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const body = await c.req.json().catch(() => ({}));
  const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().slice(0, 8).replaceAll("-", "")}`;
  const id = uuid(), expiresAt = Math.floor(Date.now() / 1e3) + Math.min(Math.max(Number(body.hours || 72), 1), 720) * 3600;
  await c.env.DB.prepare("INSERT INTO invites(id,token_hash,created_by,expires_at) VALUES(?,?,?,?)").bind(id, await sha2562(token), c.get("user").id, expiresAt).run();
  return c.json({ ok: true, invite: token, expiresAt });
});
app.get("/api/admin/users", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const result = await c.env.DB.prepare(
    `SELECT u.id,u.username,u.display_name,u.role,u.status,u.created_at,
            COALESCE(w.balance_cents,0) AS red_wallet_balance_cents
     FROM users u
     LEFT JOIN red_wallets w ON w.user_id=u.id
     ORDER BY u.created_at DESC LIMIT 500`
  ).all();
  return c.json({ users: result.results });
});
async function auditAdminFailure(c, action, targetId, reason) {
  try {
    await c.env.DB.prepare(
      "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
    ).bind(
      uuid(),
      c.get("user").id,
      action,
      targetId,
      JSON.stringify({ outcome: "failure", reason })
    ).run();
  } catch (error) {
    console.error("Failed to write admin failure audit", {
      action,
      targetId,
      reason,
      error
    });
  }
}
__name(auditAdminFailure, "auditAdminFailure");
app.post("/api/admin/users/:id/suspend", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const userId = c.req.param("id");
  const adminId = c.get("user").id;
  const target = await c.env.DB.prepare(
    "SELECT id,username,display_name,role,status FROM users WHERE id=?"
  ).bind(userId).first();
  if (!target || target.role === "admin" || target.username.startsWith("deleted_")) {
    await auditAdminFailure(c, "SUSPEND_USER_FAILED", userId, "target_missing_or_protected");
    return jsonError(c, 404, "\u7528\u6237\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u505C\u7528");
  }
  if (target.status !== "active") {
    await auditAdminFailure(c, "SUSPEND_USER_FAILED", userId, "target_not_active");
    return jsonError(c, 409, "\u8BE5\u7528\u6237\u5F53\u524D\u4E0D\u662F\u6B63\u5E38\u72B6\u6001\uFF0C\u65E0\u9700\u91CD\u590D\u505C\u7528");
  }
  const memberships = await c.env.DB.prepare(
    "SELECT conversation_id FROM conversation_members WHERE user_id=?"
  ).bind(userId).all();
  const updated = await c.env.DB.prepare(
    "UPDATE users SET status='suspended' WHERE id=? AND role!='admin' AND status='active'"
  ).bind(userId).run();
  if (Number(updated.meta.changes || 0) !== 1) {
    await auditAdminFailure(c, "SUSPEND_USER_FAILED", userId, "concurrent_status_change");
    return jsonError(c, 409, "\u8D26\u6237\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId),
    c.env.DB.prepare(
      "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
    ).bind(
      uuid(),
      adminId,
      "SUSPEND_USER",
      userId,
      JSON.stringify({
        username: target.username,
        displayName: target.display_name,
        fromStatus: target.status,
        toStatus: "suspended",
        sessionsRevoked: true
      })
    )
  ]);
  for (const row of memberships.results || []) {
    const conversationId = String(row.conversation_id || "");
    if (!conversationId) continue;
    try {
      const roomId = c.env.CHAT_ROOM.idFromName(conversationId);
      const room = c.env.CHAT_ROOM.get(roomId);
      const revokeUrl = new URL("https://chatroom.internal/_internal/revoke-member");
      revokeUrl.searchParams.set("conversationId", conversationId);
      revokeUrl.searchParams.set("userId", userId);
      await room.fetch(new Request(revokeUrl.toString(), { method: "POST" }));
    } catch (error) {
      console.error("Failed to revoke suspended user WebSocket", {
        userId,
        conversationId,
        error
      });
    }
  }
  return c.json({ ok: true });
});
app.post("/api/admin/users/:id/nickname", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const nickname = String(body.nickname || "").trim();
  if (!nickname || nickname.length > 30) {
    await auditAdminFailure(c, "UPDATE_NICKNAME_FAILED", id, "invalid_nickname");
    return jsonError(c, 400, "\u6635\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u4E14\u4E0D\u80FD\u8D85\u8FC7 30 \u4E2A\u5B57\u7B26");
  }
  const target = await c.env.DB.prepare(
    "SELECT id,username,display_name,role FROM users WHERE id=?"
  ).bind(id).first();
  if (!target || target.role === "admin" || target.username.startsWith("deleted_")) {
    await auditAdminFailure(c, "UPDATE_NICKNAME_FAILED", id, "target_missing_or_protected");
    return jsonError(c, 404, "\u7528\u6237\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u4FEE\u6539");
  }
  const oldNickname = target.display_name || "";
  if (oldNickname === nickname) {
    return c.json({ ok: true, unchanged: true });
  }
  const result = await c.env.DB.prepare(
    "UPDATE users SET display_name=? WHERE id=? AND role!='admin' AND username NOT LIKE 'deleted_%'"
  ).bind(nickname, id).run();
  if (Number(result.meta.changes || 0) !== 1) {
    await auditAdminFailure(c, "UPDATE_NICKNAME_FAILED", id, "concurrent_update");
    return jsonError(c, 409, "\u7528\u6237\u4FE1\u606F\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  await c.env.DB.prepare(
    "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
  ).bind(
    uuid(),
    c.get("user").id,
    "UPDATE_NICKNAME",
    id,
    JSON.stringify({
      username: target.username,
      fromNickname: oldNickname,
      toNickname: nickname
    })
  ).run();
  return c.json({ ok: true });
});
app.post("/api/admin/users/:id/activate", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const id = c.req.param("id");
  const target = await c.env.DB.prepare(
    "SELECT id,username,display_name,role,status FROM users WHERE id=?"
  ).bind(id).first();
  if (!target || target.role === "admin" || target.username.startsWith("deleted_")) {
    await auditAdminFailure(c, "ACTIVATE_USER_FAILED", id, "target_missing_or_protected");
    return jsonError(c, 404, "\u7528\u6237\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u6062\u590D");
  }
  if (target.status === "active") {
    return c.json({ ok: true, unchanged: true });
  }
  const result = await c.env.DB.prepare(
    "UPDATE users SET status='active' WHERE id=? AND role!='admin' AND username NOT LIKE 'deleted_%' AND status=?"
  ).bind(id, target.status).run();
  if (Number(result.meta.changes || 0) !== 1) {
    await auditAdminFailure(c, "ACTIVATE_USER_FAILED", id, "concurrent_status_change");
    return jsonError(c, 409, "\u8D26\u6237\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    c.env.DB.prepare(
      "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
    ).bind(
      uuid(),
      c.get("user").id,
      "ACTIVATE_USER",
      id,
      JSON.stringify({
        username: target.username,
        displayName: target.display_name,
        fromStatus: target.status,
        toStatus: "active",
        sessionsRevoked: true
      })
    )
  ]);
  return c.json({ ok: true });
});
app.post("/api/admin/users/:id/reset-password", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const password = String(body.password || "");
  if (password.length < 8 || password.length > 128) {
    await auditAdminFailure(c, "RESET_PASSWORD_FAILED", id, "invalid_password_format");
    return jsonError(c, 400, "\u5BC6\u7801\u957F\u5EA6\u5FC5\u987B\u4E3A 8-128 \u4E2A\u5B57\u7B26");
  }
  const target = await c.env.DB.prepare(
    "SELECT id,username,display_name,role,status FROM users WHERE id=?"
  ).bind(id).first();
  if (!target || target.role === "admin" || target.username.startsWith("deleted_")) {
    await auditAdminFailure(c, "RESET_PASSWORD_FAILED", id, "target_missing_or_protected");
    return jsonError(c, 404, "\u7528\u6237\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u4FEE\u6539");
  }
  const credentials = await makePassword(password);
  const result = await c.env.DB.prepare(
    "UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND role!='admin' AND username NOT LIKE 'deleted_%'"
  ).bind(credentials.hash, credentials.salt, id).run();
  if (Number(result.meta.changes || 0) !== 1) {
    await auditAdminFailure(c, "RESET_PASSWORD_FAILED", id, "concurrent_update");
    return jsonError(c, 409, "\u8D26\u6237\u4FE1\u606F\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    c.env.DB.prepare(
      "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
    ).bind(
      uuid(),
      c.get("user").id,
      "RESET_PASSWORD",
      id,
      JSON.stringify({
        username: target.username,
        passwordReset: true,
        passwordValueLogged: false,
        sessionsRevoked: true,
        accountStatus: target.status
      })
    )
  ]);
  return c.json({ ok: true });
});
app.post("/api/admin/users/:id/delete", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "Forbidden");
  const id = c.req.param("id");
  const adminId = c.get("user").id;
  if (id === adminId) {
    await auditAdminFailure(c, "ANONYMIZE_USER_FAILED", id, "self_anonymization_blocked");
    return jsonError(c, 400, "Cannot delete yourself");
  }
  const target = await c.env.DB.prepare(
    "SELECT id,role,username FROM users WHERE id=?"
  ).bind(id).first();
  if (!target || target.role === "admin" || target.username.startsWith("deleted_")) {
    await auditAdminFailure(c, "ANONYMIZE_USER_FAILED", id, "target_missing_or_protected");
    return jsonError(c, 404, "User not found or cannot be deleted");
  }
  const memberships = await c.env.DB.prepare(
    "SELECT conversation_id FROM conversation_members WHERE user_id=?"
  ).bind(id).all();
  const groups = await c.env.DB.prepare(
    "SELECT conversation_id FROM conversation_groups WHERE owner_id=?"
  ).bind(id).all();
  const statements = [
    c.env.DB.prepare(
      "UPDATE users SET username=?,display_name='\u5DF2\u6CE8\u9500\u7528\u6237',password_hash=?,password_salt=?,status='suspended',avatar_url=NULL WHERE id=? AND role!='admin'"
    ).bind("deleted_" + id, "disabled", "disabled", id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM friendships WHERE user_id=? OR friend_id=?").bind(id, id),
    c.env.DB.prepare("UPDATE conversation_groups SET owner_id=? WHERE owner_id=?").bind(adminId, id),
    c.env.DB.prepare(
      "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
    ).bind(uuid(), adminId, "ANONYMIZE_USER", id, JSON.stringify({ preservedHistory: true }))
  ];
  await c.env.DB.batch(statements);
  for (const group of groups.results || []) {
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO conversation_members(conversation_id,user_id,joined_at) VALUES(?,?,datetime('now'))"
    ).bind(group.conversation_id, adminId).run();
  }
  for (const row of memberships.results || []) {
    try {
      const room = c.env.CHAT_ROOM.get(c.env.CHAT_ROOM.idFromName(row.conversation_id));
      const url = new URL("https://chatroom.internal/_internal/revoke-member");
      url.searchParams.set("conversationId", row.conversation_id);
      url.searchParams.set("userId", id);
      await room.fetch(new Request(url.toString(), { method: "POST" }));
    } catch (error) {
      console.error("WebSocket revoke failed", row.conversation_id, error);
    }
  }
  return c.json({ ok: true });
});
app.get("/api/admin/users/:id/conversations", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "Forbidden");
  const userId = c.req.param("id");
  const reason = String(c.req.query("reason") || "").trim();
  if (reason.length < 3 || reason.length > 300) {
    return jsonError(c, 400, "Review reason must be 3 to 300 characters");
  }
  const target = await c.env.DB.prepare(
    "SELECT id,username,display_name FROM users WHERE id=?"
  ).bind(userId).first();
  if (!target) return jsonError(c, 404, "User not found");
  await c.env.DB.prepare(
    "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
  ).bind(
    uuid(),
    c.get("user").id,
    "VIEW_USER_CONVERSATIONS",
    userId,
    JSON.stringify({ reason })
  ).run();
  const rows = await c.env.DB.prepare(
    `SELECT
       c.id,
       c.type,
       c.created_at,
       cg.name AS group_name,
       (SELECT COUNT(*) FROM conversation_members cm2
        WHERE cm2.conversation_id=c.id) AS member_count,
       (SELECT MAX(m.created_at) FROM messages m
        WHERE m.conversation_id=c.id) AS last_message_at,
       (SELECT m.body FROM messages m
        WHERE m.conversation_id=c.id
        ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview
     FROM conversation_members cm
     JOIN conversations c ON c.id=cm.conversation_id
     LEFT JOIN conversation_groups cg ON cg.conversation_id=c.id
     WHERE cm.user_id=?
     ORDER BY COALESCE(
       (SELECT MAX(m.created_at) FROM messages m
        WHERE m.conversation_id=c.id),
       c.created_at
     ) DESC
     LIMIT 200`
  ).bind(userId).all();
  return c.json({
    user: {
      id: target.id,
      username: target.username,
      display_name: target.display_name
    },
    conversations: rows.results
  });
});
app.get("/api/conversations", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    `WITH visible_messages AS (
       SELECT m.*
       FROM messages m
       WHERE NOT EXISTS (
         SELECT 1 FROM message_deletions md
         WHERE md.message_id=m.id AND md.user_id=?
       )
     )
     SELECT c.id,c.type,
      (SELECT name FROM conversation_groups
        WHERE conversation_id=c.id) AS group_name,
      (SELECT COUNT(*) FROM conversation_members gm
        WHERE gm.conversation_id=c.id) AS member_count,
      (SELECT body FROM visible_messages m
        WHERE m.conversation_id=c.id
        ORDER BY m.created_at DESC LIMIT 1) AS last_message,
      (SELECT id FROM visible_messages m
        WHERE m.conversation_id=c.id
        ORDER BY m.created_at DESC LIMIT 1) AS last_message_id,
      (SELECT sender_id FROM visible_messages m
        WHERE m.conversation_id=c.id
        ORDER BY m.created_at DESC LIMIT 1) AS last_sender_id,
      (SELECT u.display_name FROM visible_messages m
        JOIN users u ON u.id=m.sender_id
        WHERE m.conversation_id=c.id
        ORDER BY m.created_at DESC LIMIT 1) AS last_sender_display_name,
      (SELECT created_at FROM visible_messages m
        WHERE m.conversation_id=c.id
        ORDER BY m.created_at DESC LIMIT 1) AS last_at,
      (SELECT cm2.user_id FROM conversation_members cm2
        WHERE cm2.conversation_id=c.id AND cm2.user_id!=?
        LIMIT 1) AS other_user_id,
      (SELECT u.username FROM conversation_members cm2
        JOIN users u ON u.id=cm2.user_id
        WHERE cm2.conversation_id=c.id AND cm2.user_id!=?
        LIMIT 1) AS other_username,
      (SELECT u.display_name FROM conversation_members cm2
        JOIN users u ON u.id=cm2.user_id
        WHERE cm2.conversation_id=c.id AND cm2.user_id!=?
        LIMIT 1) AS other_display_name,
      (SELECT COUNT(*) FROM visible_messages m
        LEFT JOIN conversation_reads cr
          ON cr.conversation_id=m.conversation_id AND cr.user_id=?
        WHERE m.conversation_id=c.id
          AND m.sender_id!=?
          AND m.created_at>COALESCE(cr.last_read_at,'1970-01-01T00:00:00.000Z')
      ) AS unread_count
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id=c.id
     WHERE cm.user_id=?
     ORDER BY COALESCE(last_at,c.created_at) DESC`
  ).bind(user.id, user.id, user.id, user.id, user.id, user.id, user.id).all();
  return c.json({ conversations: rows.results });
});
app.post("/api/conversations/direct", async (c) => {
  const user = c.get("user"), body = await c.req.json().catch(() => ({}));
  const other = await c.env.DB.prepare("SELECT id FROM users WHERE username=? AND status='active'").bind(body.username || "").first();
  if (!other || other.id === user.id) return jsonError(c, 404, "\u627E\u4E0D\u5230\u8BE5\u7528\u6237");
  const accepted = await c.env.DB.prepare(
    "SELECT status FROM friendships WHERE user_id=? AND friend_id=?"
  ).bind(user.id, other.id).first();
  if (!accepted || accepted.status !== "accepted") return jsonError(c, 403, "\u8BF7\u5148\u6210\u4E3A\u597D\u53CB");
  const reverse = await c.env.DB.prepare("SELECT status FROM friendships WHERE user_id=? AND friend_id=?").bind(other.id, user.id).first();
  if (!reverse || reverse.status !== "accepted") return jsonError(c, 403, "\u597D\u53CB\u5173\u7CFB\u5C1A\u672A\u786E\u8BA4");
  const existing = await c.env.DB.prepare(
    `SELECT c.id FROM conversations c
     JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=?
     JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=?
     WHERE c.type='direct' LIMIT 1`
  ).bind(user.id, other.id).first();
  if (existing) return c.json({ id: existing.id });
  const id = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO conversations(id,type) VALUES(?,'direct')").bind(id),
    c.env.DB.prepare("INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?),(?,?)").bind(id, user.id, id, other.id)
  ]);
  return c.json({ id });
});
app.post("/api/conversations/group", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 40);
  if (!name) return jsonError(c, 400, "\u8BF7\u8F93\u5165\u7FA4\u804A\u540D\u79F0");
  if (!Array.isArray(body.memberIds)) {
    return jsonError(c, 400, "\u8BF7\u9009\u62E9\u7FA4\u804A\u6210\u5458");
  }
  const memberIds = [...new Set(
    body.memberIds.map((id2) => String(id2 || "").trim()).filter((id2) => id2 && id2 !== user.id)
  )];
  if (memberIds.length < 1) {
    return jsonError(c, 400, "\u81F3\u5C11\u9009\u62E9\u4E00\u4F4D\u597D\u53CB");
  }
  if (memberIds.length > 49) {
    return jsonError(c, 400, "\u7FA4\u804A\u6700\u591A\u652F\u630150\u4F4D\u6210\u5458");
  }
  for (const friendId of memberIds) {
    const forward = await c.env.DB.prepare(
      `SELECT 1 FROM friendships f
       JOIN users u ON u.id=f.friend_id
       WHERE f.user_id=? AND f.friend_id=?
         AND f.status='accepted' AND u.status='active'`
    ).bind(user.id, friendId).first();
    const reverse = await c.env.DB.prepare(
      `SELECT 1 FROM friendships f
       JOIN users u ON u.id=f.user_id
       WHERE f.user_id=? AND f.friend_id=?
         AND f.status='accepted' AND u.status='active'`
    ).bind(friendId, user.id).first();
    if (!forward || !reverse) {
      return jsonError(c, 403, "\u53EA\u80FD\u9080\u8BF7\u5DF2\u7ECF\u4E92\u76F8\u786E\u8BA4\u7684\u597D\u53CB");
    }
  }
  const id = uuid();
  const statements = [
    c.env.DB.prepare(
      "INSERT INTO conversations(id,type) VALUES(?,'group')"
    ).bind(id),
    c.env.DB.prepare(
      "INSERT INTO conversation_groups(conversation_id,name,owner_id) VALUES(?,?,?)"
    ).bind(id, name, user.id),
    c.env.DB.prepare(
      "INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)"
    ).bind(id, user.id)
  ];
  for (const friendId of memberIds) {
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)"
      ).bind(id, friendId)
    );
  }
  await c.env.DB.batch(statements);
  return c.json({
    ok: true,
    id,
    name,
    memberCount: memberIds.length + 1
  });
});
app.patch("/api/conversations/:id/group", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const group = await c.env.DB.prepare(
    "SELECT name,announcement,owner_id FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  const admin = await c.env.DB.prepare(
    "SELECT 1 FROM group_admins WHERE conversation_id=? AND user_id=?"
  ).bind(id, user.id).first();
  if (group.owner_id !== user.id && !admin) {
    return jsonError(c, 403, "Only the group owner or admins can edit group details");
  }
  const name = body.name === void 0 ? group.name : String(body.name || "").trim();
  const announcement = body.announcement === void 0 ? group.announcement || "" : String(body.announcement || "").trim();
  if (!name || name.length > 40) {
    return jsonError(c, 400, "Group name must be 1-40 characters");
  }
  if (announcement.length > 500) {
    return jsonError(c, 400, "Announcement cannot exceed 500 characters");
  }
  await c.env.DB.prepare(
    "UPDATE conversation_groups SET name=?,announcement=? WHERE conversation_id=?"
  ).bind(name, announcement, id).run();
  return c.json({ ok: true, name, announcement });
});
app.post("/api/conversations/:id/admins/:memberId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const memberId = c.req.param("memberId");
  const group = await c.env.DB.prepare(
    "SELECT owner_id FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  if (group.owner_id !== user.id) {
    return jsonError(c, 403, "Only the group owner can appoint admins");
  }
  if (memberId === group.owner_id) {
    return jsonError(c, 400, "The owner is already the highest role");
  }
  const member = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(id, memberId).first();
  if (!member) return jsonError(c, 404, "Group member not found");
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO group_admins(conversation_id,user_id) VALUES(?,?)"
  ).bind(id, memberId).run();
  return c.json({ ok: true });
});
app.delete("/api/conversations/:id/admins/:memberId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const memberId = c.req.param("memberId");
  const group = await c.env.DB.prepare(
    "SELECT owner_id FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  if (group.owner_id !== user.id) {
    return jsonError(c, 403, "Only the group owner can remove admins");
  }
  const result = await c.env.DB.prepare(
    "DELETE FROM group_admins WHERE conversation_id=? AND user_id=?"
  ).bind(id, memberId).run();
  if (!result.meta.changes) {
    return jsonError(c, 404, "Group admin not found");
  }
  return c.json({ ok: true });
});
app.get("/api/conversations/:id/members", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const group = await c.env.DB.prepare(
    "SELECT name,owner_id,announcement FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  const current = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(id, user.id).first();
  if (!current) return jsonError(c, 403, "Not a group member");
  const result = await c.env.DB.prepare(
    `SELECT u.id,u.username,u.display_name,
            CASE WHEN u.id=? THEN 'owner'
                 WHEN ga.user_id IS NOT NULL THEN 'admin'
                 ELSE 'member' END AS role
     FROM conversation_members cm
     JOIN users u ON u.id=cm.user_id
     LEFT JOIN group_admins ga
       ON ga.conversation_id=cm.conversation_id AND ga.user_id=cm.user_id
     WHERE cm.conversation_id=?
     ORDER BY CASE WHEN u.id=? THEN 0
                   WHEN ga.user_id IS NOT NULL THEN 1 ELSE 2 END,
              u.created_at ASC`
  ).bind(group.owner_id, id, group.owner_id).all();
  return c.json({
    ok: true,
    name: group.name,
    announcement: group.announcement || "",
    ownerId: group.owner_id,
    members: result.results || []
  });
});
app.post("/api/conversations/:id/members", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const group = await c.env.DB.prepare(
    "SELECT owner_id FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  const adminRole = await c.env.DB.prepare(
    "SELECT 1 FROM group_admins WHERE conversation_id=? AND user_id=?"
  ).bind(id, user.id).first();
  if (group.owner_id !== user.id && !adminRole) {
    return jsonError(c, 403, "Only the group owner or admins can invite members");
  }
  if (!Array.isArray(body.memberIds)) {
    return jsonError(c, 400, "Select friends to invite");
  }
  const memberIds = [...new Set(
    body.memberIds.map((value) => String(value || "").trim()).filter((value) => value && value !== user.id)
  )];
  if (!memberIds.length) {
    return jsonError(c, 400, "Select at least one friend");
  }
  const current = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM conversation_members WHERE conversation_id=?"
  ).bind(id).first();
  const existingIds = [];
  for (const friendId of memberIds) {
    const exists = await c.env.DB.prepare(
      "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
    ).bind(id, friendId).first();
    if (!exists) existingIds.push(friendId);
  }
  if (Number(current?.total || 0) + existingIds.length > 50) {
    return jsonError(c, 400, "A group can have at most 50 members");
  }
  for (const friendId of existingIds) {
    const forward = await c.env.DB.prepare(
      `SELECT 1 FROM friendships f
       JOIN users u ON u.id=f.friend_id
       WHERE f.user_id=? AND f.friend_id=?
         AND f.status='accepted' AND u.status='active'`
    ).bind(user.id, friendId).first();
    const reverse = await c.env.DB.prepare(
      `SELECT 1 FROM friendships f
       JOIN users u ON u.id=f.user_id
       WHERE f.user_id=? AND f.friend_id=?
         AND f.status='accepted' AND u.status='active'`
    ).bind(friendId, user.id).first();
    if (!forward || !reverse) {
      return jsonError(c, 403, "Only confirmed active friends can be invited");
    }
  }
  if (existingIds.length) {
    await c.env.DB.batch(existingIds.map(
      (friendId) => c.env.DB.prepare(
        "INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)"
      ).bind(id, friendId)
    ));
  }
  return c.json({ ok: true, added: existingIds.length });
});
app.delete("/api/conversations/:id/members/:memberId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const memberId = c.req.param("memberId");
  const group = await c.env.DB.prepare(
    "SELECT owner_id FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  if (memberId === group.owner_id || memberId === user.id) {
    return jsonError(c, 400, "Cannot remove the owner or yourself");
  }
  const requesterAdmin = await c.env.DB.prepare(
    "SELECT 1 FROM group_admins WHERE conversation_id=? AND user_id=?"
  ).bind(id, user.id).first();
  if (group.owner_id !== user.id && !requesterAdmin) {
    return jsonError(c, 403, "Only the group owner or admins can remove members");
  }
  const targetAdmin = await c.env.DB.prepare(
    "SELECT 1 FROM group_admins WHERE conversation_id=? AND user_id=?"
  ).bind(id, memberId).first();
  if (targetAdmin && group.owner_id !== user.id) {
    return jsonError(c, 403, "Admins cannot remove other admins");
  }
  const result = await c.env.DB.prepare(
    "DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(id, memberId).run();
  if (!result.meta.changes) {
    return jsonError(c, 404, "Member not found");
  }
  await c.env.DB.prepare(
    "DELETE FROM group_admins WHERE conversation_id=? AND user_id=?"
  ).bind(id, memberId).run();
  try {
    const roomId = c.env.CHAT_ROOM.idFromName(id);
    const room = c.env.CHAT_ROOM.get(roomId);
    const revokeUrl = new URL("https://chatroom.internal/_internal/revoke-member");
    revokeUrl.searchParams.set("conversationId", id);
    revokeUrl.searchParams.set("userId", memberId);
    await room.fetch(new Request(revokeUrl.toString(), {
      method: "POST"
    }));
  } catch (error) {
  }
  return c.json({ ok: true });
});
app.delete("/api/conversations/:id/leave", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const group = await c.env.DB.prepare(
    "SELECT owner_id FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  if (group.owner_id === user.id) {
    return jsonError(c, 400, "Transfer ownership or dissolve the group first");
  }
  const result = await c.env.DB.prepare(
    "DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(id, user.id).run();
  if (!result.meta.changes) {
    return jsonError(c, 404, "You are not a group member");
  }
  await c.env.DB.prepare(
    "DELETE FROM group_admins WHERE conversation_id=? AND user_id=?"
  ).bind(id, user.id).run();
  try {
    const roomId = c.env.CHAT_ROOM.idFromName(id);
    const room = c.env.CHAT_ROOM.get(roomId);
    const revokeUrl = new URL("https://chatroom.internal/_internal/revoke-member");
    revokeUrl.searchParams.set("conversationId", id);
    revokeUrl.searchParams.set("userId", user.id);
    await room.fetch(new Request(revokeUrl.toString(), {
      method: "POST"
    }));
  } catch {
  }
  return c.json({ ok: true });
});
app.post("/api/conversations/:id/transfer-owner", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const newOwnerId = String(body.newOwnerId || "").trim();
  if (!newOwnerId || newOwnerId === user.id) {
    return jsonError(c, 400, "Invalid new owner");
  }
  const group = await c.env.DB.prepare(
    "SELECT owner_id FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  if (group.owner_id !== user.id) {
    return jsonError(c, 403, "Only the group owner can transfer ownership");
  }
  const result = await c.env.DB.prepare(
    `UPDATE conversation_groups
     SET owner_id=?
     WHERE conversation_id=?
       AND owner_id=?
       AND EXISTS (
         SELECT 1 FROM conversation_members
         WHERE conversation_id=? AND user_id=?
       )`
  ).bind(newOwnerId, id, user.id, id, newOwnerId).run();
  if (!result.meta.changes) {
    return jsonError(c, 400, "The selected user is not a current group member");
  }
  await c.env.DB.prepare(
    "DELETE FROM group_admins WHERE conversation_id=? AND user_id=?"
  ).bind(id, newOwnerId).run();
  return c.json({ ok: true, ownerId: newOwnerId });
});
app.delete("/api/conversations/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const group = await c.env.DB.prepare(
    "SELECT owner_id FROM conversation_groups WHERE conversation_id=?"
  ).bind(id).first();
  if (!group) return jsonError(c, 404, "Group not found");
  if (group.owner_id !== user.id) {
    return jsonError(c, 403, "Only the group owner can dissolve this group");
  }
  const result = await c.env.DB.prepare(
    "DELETE FROM conversations WHERE id=? AND type='group'"
  ).bind(id).run();
  if (!result.meta.changes) {
    return jsonError(c, 404, "Group not found");
  }
  try {
    let cursor;
    do {
      const page = await c.env.CHAT_IMAGES.list({
        prefix: `${id}/`,
        limit: 1e3,
        ...cursor ? { cursor } : {}
      });
      const keys = page.objects.map((object) => object.key);
      if (keys.length) await c.env.CHAT_IMAGES.delete(keys);
      if (!page.truncated) break;
      if (!page.cursor) throw new Error("R2 listing cursor missing");
      cursor = page.cursor;
    } while (true);
  } catch (error) {
    console.error("Group R2 cleanup incomplete:", id, error);
  }
  try {
    const roomId = c.env.CHAT_ROOM.idFromName(id);
    const room = c.env.CHAT_ROOM.get(roomId);
    await room.fetch(new Request(
      "https://chatroom.internal/_internal/close-room",
      { method: "POST" }
    ));
  } catch {
  }
  return c.json({ ok: true });
});
app.post("/api/conversations/:id/voices", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const member = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(conversationId, user.id).first();
  if (!member) return jsonError(c, 403, "\u65E0\u6743\u5411\u8BE5\u4F1A\u8BDD\u53D1\u9001\u8BED\u97F3");
  const contentLength = c.req.header("Content-Length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > 5242880 + 256 * 1024) {
    return jsonError(c, 413, "?????????");
  }
  let form;
  try {
    form = await c.req.formData();
  } catch {
    return jsonError(c, 400, "\u65E0\u6CD5\u8BFB\u53D6\u8BED\u97F3");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(c, 400, "\u6CA1\u6709\u5F55\u97F3\u6587\u4EF6");
  const durationValue = Number(form.get("duration_ms") || 0);
  if (!Number.isInteger(durationValue) || durationValue < 0 || durationValue > 12e4) {
    return jsonError(c, 400, "\u5F55\u97F3\u65F6\u957F\u53C2\u6570\u65E0\u6548");
  }
  const durationMs = durationValue;
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
    return jsonError(c, 400, "\u8BED\u97F3\u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 5 MB");
  }
  const allowedTypes = [
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/aac",
    "audio/3gpp"
  ];
  const mimeType = String(file.type || "").split(";")[0].toLowerCase();
  if (!allowedTypes.includes(mimeType)) {
    return jsonError(c, 400, "\u4E0D\u652F\u6301\u6B64\u5F55\u97F3\u683C\u5F0F\uFF0C\u8BF7\u4F7F\u7528\u6D4F\u89C8\u5668\u9ED8\u8BA4\u5F55\u97F3\u683C\u5F0F");
  }
  const extensionMap = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/aac": "aac",
    "audio/3gpp": "3gp"
  };
  const extension = extensionMap[mimeType] || "webm";
  const messageId = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const objectKey = `${conversationId}/${messageId}`;
  const fileName = `voice-${messageId}.${extension}`;
  const bytes = await file.arrayBuffer();
  try {
    await c.env.CHAT_IMAGES.put(objectKey, bytes, {
      httpMetadata: { contentType: mimeType }
    });
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO messages(
          id,conversation_id,sender_id,body,message_type,created_at
        )
        SELECT ?,?,?,?,'voice',?
        WHERE EXISTS (
 SELECT 1
 FROM conversation_members cm
 JOIN users u ON u.id=cm.user_id
 WHERE cm.conversation_id=? AND cm.user_id=?
   AND u.status='active'
)`
      ).bind(
        messageId,
        conversationId,
        user.id,
        "\u8BED\u97F3\u6D88\u606F",
        createdAt,
        conversationId,
        user.id
      ),
      c.env.DB.prepare(
        `INSERT INTO message_attachments(
          message_id,object_key,mime_type,file_name,file_size,duration_ms,created_at
        ) VALUES(?,?,?,?,?,?,?)`
      ).bind(messageId, objectKey, mimeType, fileName, file.size, durationMs, createdAt)
    ]);
  } catch (error) {
    try {
      await c.env.CHAT_IMAGES.delete(objectKey);
    } catch {
    }
    console.error("Voice upload failed:", error);
    return jsonError(c, 500, "\u8BED\u97F3\u4FDD\u5B58\u5931\u8D25");
  }
  try {
    const roomId = c.env.CHAT_ROOM.idFromName(conversationId);
    const room = c.env.CHAT_ROOM.get(roomId);
    await room.fetch(new Request(
      "https://chatroom.internal/_internal/broadcast-message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messageId,
          senderId: user.id,
          createdAt,
          fileName,
          fileSize: file.size,
          durationMs,
          mimeType,
          messageType: "voice"
        })
      }
    ));
  } catch (error) {
    console.error("Voice broadcast failed:", error);
  }
  return c.json({ ok: true, messageId, messageType: "voice" });
});
app.get("/api/conversations/:id/voices/:messageId", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const messageId = c.req.param("messageId");
  const row = await c.env.DB.prepare(
    `SELECT a.object_key,a.mime_type
     FROM message_attachments a
     JOIN messages m ON m.id=a.message_id
     JOIN conversation_members cm
       ON cm.conversation_id=m.conversation_id
     WHERE m.id=? AND m.conversation_id=?
       AND m.message_type='voice'
       AND cm.user_id=? AND m.recalled_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM message_deletions md
         WHERE md.message_id=m.id AND md.user_id=?
       )`
  ).bind(messageId, conversationId, user.id, user.id).first();
  if (!row) return jsonError(c, 404, "\u8BED\u97F3\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u64AD\u653E");
  const object = await c.env.CHAT_IMAGES.get(row.object_key);
  if (!object) return jsonError(c, 404, "\u8BED\u97F3\u6587\u4EF6\u4E0D\u5B58\u5728");
  const allowedTypes = [
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/aac",
    "audio/3gpp"
  ];
  const mimeType = allowedTypes.includes(row.mime_type) ? row.mime_type : "audio/webm";
  return new Response(object.body, {
    headers: {
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
});
app.post("/api/conversations/:id/files", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const member = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(conversationId, user.id).first();
  if (!member) return jsonError(c, 403, "\u65E0\u6743\u5411\u8BE5\u4F1A\u8BDD\u53D1\u9001\u6587\u4EF6");
  const contentLength = c.req.header("Content-Length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > 20971520 + 256 * 1024) {
    return jsonError(c, 413, "?????????");
  }
  let form;
  try {
    form = await c.req.formData();
  } catch {
    return jsonError(c, 400, "\u65E0\u6CD5\u8BFB\u53D6\u4E0A\u4F20\u6587\u4EF6");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(c, 400, "\u8BF7\u9009\u62E9\u6587\u4EF6");
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
    return jsonError(c, 400, "\u6587\u4EF6\u5927\u5C0F\u5FC5\u987B\u5927\u4E8E 0 \u4E14\u4E0D\u80FD\u8D85\u8FC7 20 MB");
  }
  const bytes = await file.arrayBuffer();
  const messageId = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const objectKey = `${conversationId}/${messageId}`;
  const fileName = String(file.name || "download").replace(/[\\\/\r\n\0]/g, "_").replace(/[\x00-\x1F\x7F]/g, "_").slice(0, 180) || "download";
  const mimeType = "application/octet-stream";
  try {
    await c.env.CHAT_IMAGES.put(objectKey, bytes, {
      httpMetadata: { contentType: mimeType }
    });
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO messages(
          id,conversation_id,sender_id,body,message_type,created_at
        )
        SELECT ?,?,?,?,'file',?
        WHERE EXISTS (
 SELECT 1
 FROM conversation_members cm
 JOIN users u ON u.id=cm.user_id
 WHERE cm.conversation_id=? AND cm.user_id=?
   AND u.status='active'
)`
      ).bind(
        messageId,
        conversationId,
        user.id,
        fileName,
        createdAt,
        conversationId,
        user.id
      ),
      c.env.DB.prepare(
        `INSERT INTO message_attachments(
          message_id,object_key,mime_type,file_name,file_size,created_at
        ) VALUES(?,?,?,?,?,?)`
      ).bind(messageId, objectKey, mimeType, fileName, file.size, createdAt)
    ]);
  } catch (error) {
    try {
      await c.env.CHAT_IMAGES.delete(objectKey);
    } catch {
    }
    console.error("File upload failed:", error);
    return jsonError(c, 500, "\u6587\u4EF6\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
  }
  try {
    const roomId = c.env.CHAT_ROOM.idFromName(conversationId);
    const room = c.env.CHAT_ROOM.get(roomId);
    await room.fetch(new Request(
      "https://chatroom.internal/_internal/broadcast-message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messageId,
          senderId: user.id,
          createdAt,
          fileName,
          fileSize: file.size,
          mimeType,
          messageType: "file"
        })
      }
    ));
  } catch (error) {
    console.error("File broadcast failed:", error);
  }
  return c.json({ ok: true, messageId, messageType: "file" });
});
app.get("/api/conversations/:id/files/:messageId", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const messageId = c.req.param("messageId");
  const row = await c.env.DB.prepare(
    `SELECT a.object_key,a.file_name
     FROM message_attachments a
     JOIN messages m ON m.id=a.message_id
     JOIN conversation_members cm
       ON cm.conversation_id=m.conversation_id
     WHERE m.id=? AND m.conversation_id=?
       AND m.message_type='file'
       AND cm.user_id=? AND m.recalled_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM message_deletions md
         WHERE md.message_id=m.id AND md.user_id=?
       )`
  ).bind(messageId, conversationId, user.id, user.id).first();
  if (!row) return jsonError(c, 404, "\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u4E0B\u8F7D");
  const object = await c.env.CHAT_IMAGES.get(row.object_key);
  if (!object) return jsonError(c, 404, "\u6587\u4EF6\u5185\u5BB9\u4E0D\u5B58\u5728");
  const safeName = String(row.file_name || "download");
  const encodedName = encodeURIComponent(safeName);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
});
app.post("/api/conversations/:id/images", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const member = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(conversationId, user.id).first();
  if (!member) return jsonError(c, 403, "\u65E0\u6743\u5411\u8BE5\u4F1A\u8BDD\u53D1\u9001\u56FE\u7247");
  const contentLength = c.req.header("Content-Length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > 8388608 + 256 * 1024) {
    return jsonError(c, 413, "?????????");
  }
  let form;
  try {
    form = await c.req.formData();
  } catch {
    return jsonError(c, 400, "\u65E0\u6CD5\u8BFB\u53D6\u4E0A\u4F20\u6587\u4EF6");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(c, 400, "\u8BF7\u9009\u62E9\u56FE\u7247");
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) {
    return jsonError(c, 400, "\u56FE\u7247\u5927\u5C0F\u4E0D\u80FD\u8D85\u8FC7 8 MB");
  }
  const bytes = await file.arrayBuffer();
  const data = new Uint8Array(bytes);
  let mimeType = "";
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) {
    mimeType = "image/jpeg";
  } else if (data.length >= 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71 && data[4] === 13 && data[5] === 10 && data[6] === 26 && data[7] === 10) {
    mimeType = "image/png";
  } else if (data.length >= 12 && data[0] === 82 && data[1] === 73 && data[2] === 70 && data[3] === 70 && data[8] === 87 && data[9] === 69 && data[10] === 66 && data[11] === 80) {
    mimeType = "image/webp";
  } else if (data.length >= 6 && data[0] === 71 && data[1] === 73 && data[2] === 70 && data[3] === 56 && (data[4] === 55 || data[4] === 57) && data[5] === 97) {
    mimeType = "image/gif";
  } else {
    return jsonError(c, 400, "\u53EA\u652F\u6301 JPEG\u3001PNG\u3001WebP\u3001GIF \u56FE\u7247");
  }
  const messageId = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const objectKey = `${conversationId}/${messageId}`;
  const fileName = String(file.name || "image").replace(/[\\\/\r\n\0]/g, "_").slice(0, 120) || "image";
  try {
    await c.env.CHAT_IMAGES.put(objectKey, bytes, {
      httpMetadata: { contentType: mimeType }
    });
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO messages(
          id,conversation_id,sender_id,body,message_type,created_at
        )
        SELECT ?,?,?,?,'image',?
        WHERE EXISTS (
 SELECT 1
 FROM conversation_members cm
 JOIN users u ON u.id=cm.user_id
 WHERE cm.conversation_id=? AND cm.user_id=?
   AND u.status='active'
)`
      ).bind(
        messageId,
        conversationId,
        user.id,
        "\u56FE\u7247",
        createdAt,
        conversationId,
        user.id
      ),
      c.env.DB.prepare(
        `INSERT INTO message_attachments(
          message_id,object_key,mime_type,file_name,file_size,created_at
        ) VALUES(?,?,?,?,?,?)`
      ).bind(messageId, objectKey, mimeType, fileName, file.size, createdAt)
    ]);
  } catch (error) {
    try {
      await c.env.CHAT_IMAGES.delete(objectKey);
    } catch {
    }
    console.error("Image upload failed:", error);
    return jsonError(c, 500, "\u56FE\u7247\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
  }
  try {
    const roomId = c.env.CHAT_ROOM.idFromName(conversationId);
    const room = c.env.CHAT_ROOM.get(roomId);
    await room.fetch(new Request(
      "https://chatroom.internal/_internal/broadcast-message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messageId,
          senderId: user.id,
          createdAt,
          fileName,
          fileSize: file.size,
          mimeType
        })
      }
    ));
  } catch (error) {
    console.error("Image broadcast failed:", error);
  }
  return c.json({ ok: true, messageId, messageType: "image" });
});
app.get("/api/conversations/:id/images/:messageId", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const messageId = c.req.param("messageId");
  const row = await c.env.DB.prepare(
    `SELECT a.object_key,a.mime_type
     FROM message_attachments a
     JOIN messages m ON m.id=a.message_id
     JOIN conversation_members cm
       ON cm.conversation_id=m.conversation_id
     WHERE m.id=? AND m.conversation_id=?
       AND cm.user_id=?
  AND m.message_type='image'
  AND m.recalled_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM message_deletions md
         WHERE md.message_id=m.id AND md.user_id=?
       )`
  ).bind(messageId, conversationId, user.id, user.id).first();
  if (!row) return jsonError(c, 404, "\u56FE\u7247\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u67E5\u770B");
  const object = await c.env.CHAT_IMAGES.get(row.object_key);
  if (!object) return jsonError(c, 404, "\u56FE\u7247\u6587\u4EF6\u4E0D\u5B58\u5728");
  return new Response(object.body, {
    headers: {
      "Content-Type": row.mime_type,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
});
app.get("/api/conversations/:id/members/:memberId/avatar", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const memberId = c.req.param("memberId");
  const row = await c.env.DB.prepare(
    `SELECT u.avatar_url
     FROM conversation_members mine
     JOIN conversation_members target
       ON target.conversation_id=mine.conversation_id
     JOIN users u ON u.id=target.user_id
     WHERE mine.conversation_id=?
       AND mine.user_id=?
       AND target.user_id=?
       AND u.status='active'`
  ).bind(conversationId, user.id, memberId).first();
  if (!row) return jsonError(c, 403, "\u65E0\u6743\u67E5\u770B\u8BE5\u6210\u5458\u5934\u50CF");
  if (!row.avatar_url) return jsonError(c, 404, "\u8BE5\u6210\u5458\u5C1A\u672A\u8BBE\u7F6E\u5934\u50CF");
  const object = await c.env.CHAT_IMAGES.get(row.avatar_url);
  if (!object) return jsonError(c, 404, "\u5934\u50CF\u6587\u4EF6\u4E0D\u5B58\u5728");
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
});
async function expireRedEnvelope(db, envelopeId) {
  const now = Math.floor(Date.now() / 1e3);
  const refundId = uuid();
  await db.batch([
    // 1. 仅对仍然有效且已过期的红包，把剩余金额退回发送者钱包
    db.prepare(
      `UPDATE red_wallets
       SET balance_cents=balance_cents+(
         SELECT remaining_cents FROM red_envelopes
         WHERE id=? AND status='open' AND expires_at<=? AND refunded_at IS NULL
       ), updated_at=datetime('now')
       WHERE user_id=(
         SELECT sender_id FROM red_envelopes
         WHERE id=? AND status='open' AND expires_at<=? AND refunded_at IS NULL
       )`
    ).bind(envelopeId, now, envelopeId, now),
    // 2. 如果红包还有余额，但发送者钱包不存在，强制回滚
    db.prepare(
      `INSERT INTO red_wallet_ledger
       (id,user_id,entry_type,delta_cents,balance_after_cents)
       SELECT ?,sender_id,'envelope_refund',0,0
       FROM red_envelopes
       WHERE id=? AND status='open' AND expires_at<=?
         AND refunded_at IS NULL AND remaining_cents>0
         AND changes()=0`
    ).bind(uuid(), envelopeId, now),
    // 3. 记录退款账本，余额采用钱包更新后的实际余额
    db.prepare(
      `INSERT INTO red_wallet_ledger
       (id,user_id,entry_type,delta_cents,balance_after_cents,reference_id,note)
       SELECT ?,e.sender_id,'envelope_refund',e.remaining_cents,
         w.balance_cents,e.id,'\u7EA2\u5305\u8FC7\u671F\u9000\u6B3E'
       FROM red_envelopes e
       JOIN red_wallets w ON w.user_id=e.sender_id
       WHERE e.id=? AND e.status='open' AND e.expires_at<=?
         AND e.refunded_at IS NULL AND e.remaining_cents>0`
    ).bind(refundId, envelopeId, now),
    // 4. 有剩余金额却没有退款账本，强制回滚
    db.prepare(
      `INSERT INTO red_wallet_ledger
       (id,user_id,entry_type,delta_cents,balance_after_cents)
       SELECT ?,sender_id,'envelope_refund',0,0
       FROM red_envelopes
       WHERE id=? AND status='open' AND expires_at<=?
         AND refunded_at IS NULL AND remaining_cents>0
         AND changes()=0`
    ).bind(uuid(), envelopeId, now),
    // 5. 退款成功后才将红包标记为过期；零余额红包可直接过期
    db.prepare(
      `UPDATE red_envelopes
       SET status='expired',
           remaining_cents=0,
           remaining_count=0,
           refunded_at=datetime('now')
       WHERE id=? AND status='open' AND expires_at<=?
         AND refunded_at IS NULL
         AND (
           remaining_cents=0 OR EXISTS (
             SELECT 1 FROM red_wallet_ledger
             WHERE entry_type='envelope_refund'
               AND reference_id=red_envelopes.id
           )
         )`
    ).bind(envelopeId, now)
  ]);
}
__name(expireRedEnvelope, "expireRedEnvelope");
app.get("/api/me/red-wallet", async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO red_wallets(user_id) VALUES(?)"
  ).bind(user.id).run();
  const wallet = await c.env.DB.prepare(
    "SELECT balance_cents,updated_at FROM red_wallets WHERE user_id=?"
  ).bind(user.id).first();
  const ledger = await c.env.DB.prepare(
    `SELECT id,entry_type,delta_cents,balance_after_cents,reference_id,note,created_at
     FROM red_wallet_ledger WHERE user_id=?
     ORDER BY created_at DESC LIMIT 30`
  ).bind(user.id).all();
  return c.json({
    balanceCents: Number(wallet?.balance_cents || 0),
    updatedAt: wallet?.updated_at || null,
    ledger: ledger.results || []
  });
});
app.post("/api/conversations/:id/red-envelopes", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const totalCents = Number(body.totalCents);
  const totalCount = Number(body.totalCount);
  const envelopeType = String(body.envelopeType || "random");
  const greeting = String(body.greeting || "\u606D\u559C\u53D1\u8D22\uFF0C\u5927\u5409\u5927\u5229").trim().slice(0, 40);
  if (!Number.isSafeInteger(totalCents) || totalCents < 1 || totalCents > 2e5) {
    return jsonError(c, 400, "\u7EA2\u5305\u91D1\u989D\u5FC5\u987B\u57280.01\u81F32000\u5143\u4E4B\u95F4");
  }
  if (!Number.isSafeInteger(totalCount) || totalCount < 1 || totalCount > 100) {
    return jsonError(c, 400, "\u7EA2\u5305\u4E2A\u6570\u5FC5\u987B\u4E3A1\u81F3100\u4E2A");
  }
  if (totalCents < totalCount) {
    return jsonError(c, 400, "\u7EA2\u5305\u603B\u91D1\u989D\u4E0D\u8DB3\u4EE5\u5206\u7ED9\u6240\u6709\u4EBA");
  }
  if (!["fixed", "random"].includes(envelopeType)) {
    return jsonError(c, 400, "\u7EA2\u5305\u7C7B\u578B\u65E0\u6548");
  }
  if (envelopeType === "fixed" && totalCents % totalCount !== 0) {
    return jsonError(c, 400, "\u666E\u901A\u7EA2\u5305\u603B\u91D1\u989D\u5FC5\u987B\u80FD\u88AB\u7EA2\u5305\u4E2A\u6570\u6574\u9664");
  }
  const membership = await c.env.DB.prepare(
    `SELECT COUNT(*) AS member_count
     FROM conversation_members cm
     JOIN users u ON u.id=cm.user_id
     WHERE cm.conversation_id=? AND u.status='active'`
  ).bind(conversationId).first();
  const memberCount = Number(membership?.member_count || 0);
  if (memberCount < 2) return jsonError(c, 403, "\u4F1A\u8BDD\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u53D1\u9001\u7EA2\u5305");
  if (totalCount > Math.min(100, memberCount - 1)) {
    return jsonError(c, 400, "\u7EA2\u5305\u4E2A\u6570\u4E0D\u80FD\u8D85\u8FC7\u5176\u4ED6\u6709\u6548\u4F1A\u8BDD\u6210\u5458\u4EBA\u6570");
  }
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO red_wallets(user_id) VALUES(?)"
  ).bind(user.id).run();
  const envelopeId = uuid();
  const messageId = uuid();
  const ledgerId = uuid();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const expiresAt = Math.floor(Date.now() / 1e3) + 86400;
  let results;
  try {
    results = await c.env.DB.batch([
      // 1. 先扣款，且必须仍然是会话成员
      c.env.DB.prepare(
        `UPDATE red_wallets
         SET balance_cents=balance_cents-?,
             updated_at=datetime('now')
         WHERE user_id=? AND balance_cents>=?
           AND EXISTS (
             SELECT 1 FROM conversation_members
             WHERE conversation_id=? AND user_id=?
           )`
      ).bind(totalCents, user.id, totalCents, conversationId, user.id),
      // 2. 扣款影响行数为 0 时，利用 CHECK 约束强制整个 batch 回滚
      c.env.DB.prepare(
        `INSERT INTO red_wallet_ledger
         (id,user_id,entry_type,delta_cents,balance_after_cents)
         SELECT ?,?,'envelope_send',0,0 WHERE changes()=0`
      ).bind(uuid(), user.id),
      // 3. 扣款成功后才创建聊天消息
      c.env.DB.prepare(
        `INSERT INTO messages
         (id,conversation_id,sender_id,body,message_type,created_at)
         VALUES(?,?,?,?,'red_envelope',?)`
      ).bind(messageId, conversationId, user.id, envelopeId, createdAt),
      // 4. 创建红包记录
      c.env.DB.prepare(
        `INSERT INTO red_envelopes
         (id,conversation_id,sender_id,total_cents,remaining_cents,
          total_count,remaining_count,envelope_type,greeting,expires_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        envelopeId,
        conversationId,
        user.id,
        totalCents,
        totalCents,
        totalCount,
        totalCount,
        envelopeType,
        greeting,
        expiresAt
      ),
      // 5. 写入真实扣款账本，记录扣款后的余额
      c.env.DB.prepare(
        `INSERT INTO red_wallet_ledger
         (id,user_id,entry_type,delta_cents,balance_after_cents,reference_id,note)
         SELECT ?,?,'envelope_send',-?,balance_cents,?,'\u53D1\u9001\u7EA2\u5305'
         FROM red_wallets WHERE user_id=?`
      ).bind(ledgerId, user.id, totalCents, envelopeId, user.id)
    ]);
  } catch (error) {
    console.error("Red envelope send transaction rolled back", error);
    return jsonError(c, 409, "\u4F59\u989D\u4E0D\u8DB3\u6216\u4F59\u989D\u521A\u521A\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  if (!Number(results[0]?.meta?.changes || 0)) {
    return jsonError(c, 409, "\u4F59\u989D\u4E0D\u8DB3\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  try {
    const room = c.env.CHAT_ROOM.get(
      c.env.CHAT_ROOM.idFromName(conversationId)
    );
    const response = await room.fetch(new Request(
      "https://chatroom.internal/_internal/broadcast-red-envelope",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, messageId, envelopeId, senderId: user.id })
      }
    ));
    if (!response.ok) {
      console.error("Red envelope broadcast failed", await response.text());
    }
  } catch (error) {
    console.error("Red envelope broadcast error", error);
  }
  const wallet = await c.env.DB.prepare(
    "SELECT balance_cents FROM red_wallets WHERE user_id=?"
  ).bind(user.id).first();
  return c.json({
    ok: true,
    envelopeId,
    messageId,
    balanceCents: Number(wallet?.balance_cents || 0)
  });
});
app.post("/api/red-envelopes/:id/claim", async (c) => {
  const user = c.get("user");
  const envelopeId = c.req.param("id");
  const now = Math.floor(Date.now() / 1e3);
  const envelope = await c.env.DB.prepare(
    `SELECT e.* FROM red_envelopes e
     JOIN conversation_members cm ON cm.conversation_id=e.conversation_id
     WHERE e.id=? AND cm.user_id=?`
  ).bind(envelopeId, user.id).first();
  if (!envelope) return jsonError(c, 404, "\u7EA2\u5305\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u9886\u53D6");
  if (Number(envelope.expires_at) <= now && envelope.status === "open") {
    await expireRedEnvelope(c.env.DB, envelopeId);
    return jsonError(c, 410, "\u7EA2\u5305\u5DF2\u8FC7\u671F\uFF0C\u672A\u9886\u53D6\u91D1\u989D\u5DF2\u9000\u56DE");
  }
  if (envelope.sender_id === user.id) {
    return jsonError(c, 403, "\u4E0D\u80FD\u9886\u53D6\u81EA\u5DF1\u53D1\u51FA\u7684\u7EA2\u5305");
  }
  if (envelope.status !== "open" || Number(envelope.remaining_count) <= 0) {
    return jsonError(c, 409, "\u7EA2\u5305\u5DF2\u7ECF\u9886\u5B8C");
  }
  const oldCount = Number(envelope.remaining_count);
  const oldRemaining = Number(envelope.remaining_cents);
  let amount = oldRemaining;
  if (oldCount > 1) {
    if (envelope.envelope_type === "fixed") {
      amount = Math.floor(Number(envelope.total_cents) / Number(envelope.total_count));
    } else {
      const max = Math.min(
        oldRemaining - oldCount + 1,
        Math.ceil(oldRemaining * 2 / oldCount)
      );
      const random = crypto.getRandomValues(new Uint32Array(1))[0];
      amount = 1 + random % Math.max(1, max);
    }
  }
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO red_wallets(user_id) VALUES(?)"
  ).bind(user.id).run();
  const claimId = uuid();
  const ledgerId = uuid();
  let results;
  try {
    results = await c.env.DB.batch([
      // 1. 插入领取记录：校验红包状态、余额、数量、成员身份和重复领取
      c.env.DB.prepare(
        `INSERT INTO red_envelope_claims(id,envelope_id,user_id,amount_cents)
         SELECT ?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM red_envelopes
           WHERE id=? AND status='open' AND expires_at>?
             AND remaining_count=? AND remaining_cents=?
             AND remaining_count>0 AND remaining_cents>=?
             AND sender_id<>?
         )
         AND NOT EXISTS (
           SELECT 1 FROM red_envelope_claims
           WHERE envelope_id=? AND user_id=?
         )
         AND EXISTS (
           SELECT 1 FROM conversation_members
           WHERE conversation_id=? AND user_id=?
         )`
      ).bind(
        claimId,
        envelopeId,
        user.id,
        amount,
        envelopeId,
        now,
        oldCount,
        oldRemaining,
        amount,
        user.id,
        envelopeId,
        user.id,
        envelope.conversation_id,
        user.id
      ),
      // 2. 如果领取记录没有成功写入，强制回滚
      c.env.DB.prepare(
        `INSERT INTO red_wallet_ledger
         (id,user_id,entry_type,delta_cents,balance_after_cents)
         SELECT ?,?,'envelope_claim',0,0
         WHERE NOT EXISTS (
           SELECT 1 FROM red_envelope_claims WHERE id=?
         )`
      ).bind(uuid(), user.id, claimId),
      // 3. 扣减红包剩余金额和数量
      c.env.DB.prepare(
        `UPDATE red_envelopes
         SET remaining_cents=remaining_cents-?,
             remaining_count=remaining_count-1,
             status=CASE WHEN remaining_count=1 THEN 'completed' ELSE status END
         WHERE id=? AND status='open'
           AND remaining_count=? AND remaining_cents=?
           AND expires_at>?
           AND EXISTS (
             SELECT 1 FROM red_envelope_claims WHERE id=?
           )`
      ).bind(amount, envelopeId, oldCount, oldRemaining, now, claimId),
      // 4. 明确检查红包扣减后的状态，不一致就回滚
      c.env.DB.prepare(
        `INSERT INTO red_wallet_ledger
         (id,user_id,entry_type,delta_cents,balance_after_cents)
         SELECT ?,?,'envelope_claim',0,0
         WHERE NOT EXISTS (
           SELECT 1 FROM red_envelopes
           WHERE id=?
             AND remaining_count=?
             AND remaining_cents=?
             AND status=?
         )`
      ).bind(
        uuid(),
        user.id,
        envelopeId,
        oldCount - 1,
        oldRemaining - amount,
        oldCount === 1 ? "completed" : "open"
      ),
      // 5. 只有红包扣减成功才给领取者入账
      c.env.DB.prepare(
        `UPDATE red_wallets
         SET balance_cents=balance_cents+?,
             updated_at=datetime('now')
         WHERE user_id=?
           AND EXISTS (
             SELECT 1 FROM red_envelope_claims WHERE id=?
           )
           AND EXISTS (
             SELECT 1 FROM red_envelopes
             WHERE id=? AND remaining_count=? AND remaining_cents=?
           )`
      ).bind(
        amount,
        user.id,
        claimId,
        envelopeId,
        oldCount - 1,
        oldRemaining - amount
      ),
      // 6. 钱包更新未成功则回滚
      c.env.DB.prepare(
        `INSERT INTO red_wallet_ledger
         (id,user_id,entry_type,delta_cents,balance_after_cents)
         SELECT ?,?,'envelope_claim',0,0 WHERE changes()=0`
      ).bind(uuid(), user.id),
      // 7. 写入正式账本
      c.env.DB.prepare(
        `INSERT INTO red_wallet_ledger
         (id,user_id,entry_type,delta_cents,balance_after_cents,reference_id,note)
         SELECT ?,?,'envelope_claim',?,balance_cents,?,'\u9886\u53D6\u7EA2\u5305'
         FROM red_wallets
         WHERE user_id=?
           AND EXISTS (SELECT 1 FROM red_envelope_claims WHERE id=?)`
      ).bind(ledgerId, user.id, amount, claimId, user.id, claimId)
    ]);
  } catch (error) {
    console.error("Red envelope claim transaction rolled back", error);
    return jsonError(c, 409, "\u7EA2\u5305\u72B6\u6001\u521A\u521A\u53D1\u751F\u53D8\u5316\uFF0C\u6216\u9886\u53D6\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  if (!Number(results[0]?.meta?.changes || 0)) {
    const previous = await c.env.DB.prepare(
      "SELECT 1 FROM red_envelope_claims WHERE envelope_id=? AND user_id=?"
    ).bind(envelopeId, user.id).first();
    return jsonError(c, 409, previous ? "\u4F60\u5DF2\u7ECF\u9886\u53D6\u8FC7\u8FD9\u4E2A\u7EA2\u5305" : "\u7EA2\u5305\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  }
  try {
    const room = c.env.CHAT_ROOM.get(
      c.env.CHAT_ROOM.idFromName(envelope.conversation_id)
    );
    await room.fetch(new Request(
      "https://chatroom.internal/_internal/broadcast-red-envelope-update",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: envelope.conversation_id,
          envelopeId
        })
      }
    ));
  } catch (error) {
    console.error("Red envelope update broadcast failed", error);
  }
  const wallet = await c.env.DB.prepare(
    "SELECT balance_cents FROM red_wallets WHERE user_id=?"
  ).bind(user.id).first();
  return c.json({
    ok: true,
    amountCents: amount,
    balanceCents: Number(wallet?.balance_cents || 0)
  });
});
app.get("/api/red-envelopes/:id", async (c) => {
  const user = c.get("user");
  const envelopeId = c.req.param("id");
  let envelope = await c.env.DB.prepare(
    `SELECT e.*,u.display_name AS sender_name
     FROM red_envelopes e
     JOIN users u ON u.id=e.sender_id
     JOIN conversation_members cm ON cm.conversation_id=e.conversation_id
     WHERE e.id=? AND cm.user_id=?`
  ).bind(envelopeId, user.id).first();
  if (!envelope) return jsonError(c, 404, "\u7EA2\u5305\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u67E5\u770B");
  if (envelope.status === "open" && Number(envelope.expires_at) <= Math.floor(Date.now() / 1e3)) {
    await expireRedEnvelope(c.env.DB, envelopeId);
    envelope = await c.env.DB.prepare(
      `SELECT e.*,u.display_name AS sender_name
       FROM red_envelopes e JOIN users u ON u.id=e.sender_id
       WHERE e.id=?`
    ).bind(envelopeId).first();
  }
  const claims = await c.env.DB.prepare(
    `SELECT cl.user_id,cl.amount_cents,cl.created_at,u.display_name
     FROM red_envelope_claims cl JOIN users u ON u.id=cl.user_id
     WHERE cl.envelope_id=? ORDER BY cl.created_at ASC`
  ).bind(envelopeId).all();
  const mine = await c.env.DB.prepare(
    "SELECT amount_cents FROM red_envelope_claims WHERE envelope_id=? AND user_id=?"
  ).bind(envelopeId, user.id).first();
  return c.json({
    envelope,
    claims: claims.results || [],
    myClaimCents: mine ? Number(mine.amount_cents) : null
  });
});
app.post("/api/admin/users/:id/red-wallet/grant", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const userId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  const note = String(body.note || "\u7BA1\u7406\u5458\u53D1\u653E\u865A\u62DF\u7EA2\u5305\u4F59\u989D").trim().slice(0, 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 1e8) {
    return jsonError(c, 400, "\u53D1\u653E\u91D1\u989D\u65E0\u6548");
  }
  const target = await c.env.DB.prepare(
    "SELECT id FROM users WHERE id=? AND status='active'"
  ).bind(userId).first();
  if (!target) return jsonError(c, 404, "\u7528\u6237\u4E0D\u5B58\u5728\u6216\u5DF2\u505C\u7528");
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO red_wallets(user_id) VALUES(?)"
  ).bind(userId).run();
  const ledgerId = uuid();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE red_wallets SET balance_cents=balance_cents+?,
       updated_at=datetime('now') WHERE user_id=?`
    ).bind(amountCents, userId),
    c.env.DB.prepare(
      `INSERT INTO red_wallet_ledger
       (id,user_id,entry_type,delta_cents,balance_after_cents,reference_id,note)
       SELECT ?,?,'admin_grant',?,balance_cents,?,?
       FROM red_wallets WHERE user_id=?`
    ).bind(ledgerId, userId, amountCents, ledgerId, note, userId)
  ]);
  const wallet = await c.env.DB.prepare(
    "SELECT balance_cents FROM red_wallets WHERE user_id=?"
  ).bind(userId).first();
  return c.json({ ok: true, balanceCents: Number(wallet?.balance_cents || 0) });
});
app.get("/api/conversations/:id/messages", async (c) => {
  const user = c.get("user"), id = c.req.param("id");
  const member = await c.env.DB.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").bind(id, user.id).first();
  if (!member) return jsonError(c, 403, "\u65E0\u6743\u67E5\u770B\u8BE5\u4F1A\u8BDD");
  const rows = await c.env.DB.prepare(
    `SELECT m.id,m.sender_id,m.body,m.message_type,m.created_at,m.recalled_at,m.forwarded_from,m.reply_to,
       u.display_name AS sender_display_name,
       u.avatar_url AS sender_avatar_url,
       re.total_cents AS red_total_cents,
       re.remaining_cents AS red_remaining_cents,
       re.total_count AS red_total_count,
       re.remaining_count AS red_remaining_count,
       re.envelope_type AS red_envelope_type,
       re.greeting AS red_greeting,
       re.status AS red_status,
       re.expires_at AS red_expires_at,
       re.sender_id AS red_sender_id,
       a.mime_type AS image_mime_type,
       a.file_name AS image_file_name,
       a.file_size AS image_file_size,
       a.duration_ms AS duration_ms,
       CASE WHEN m.sender_id=? AND EXISTS (
         SELECT 1 FROM conversation_reads cr
         WHERE cr.conversation_id=m.conversation_id
           AND cr.user_id<>?
           AND cr.last_read_at >= m.created_at
       ) THEN 1 ELSE 0 END AS is_read
     FROM messages m
     JOIN users u ON u.id=m.sender_id
     LEFT JOIN message_attachments a ON a.message_id=m.id
     LEFT JOIN red_envelopes re
       ON re.id=m.body AND m.message_type='red_envelope'
     WHERE m.conversation_id=?
       AND NOT EXISTS (
         SELECT 1 FROM message_deletions md
         WHERE md.message_id=m.id AND md.user_id=?
       )
     ORDER BY m.created_at DESC LIMIT 100`
  ).bind(user.id, user.id, id, user.id).all();
  return c.json({ messages: [...rows.results || []].reverse() });
});
app.post("/api/conversations/:id/forward", async (c) => {
  const user = c.get("user");
  const targetId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const sourceId = String(body.messageId || "").trim();
  if (!sourceId) return jsonError(c, 400, "?????????");
  const targetMember = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(targetId, user.id).first();
  if (!targetMember) return jsonError(c, 403, "????????");
  const source = await c.env.DB.prepare(
    `SELECT m.id,m.conversation_id,m.body,m.message_type,m.recalled_at,
            a.object_key,a.mime_type,a.file_name,a.file_size,a.duration_ms
     FROM messages m
     JOIN conversation_members cm
       ON cm.conversation_id=m.conversation_id AND cm.user_id=?
     LEFT JOIN message_attachments a ON a.message_id=m.id
     WHERE m.id=?
       AND m.message_type IN ('text','image','file','voice')
       AND m.recalled_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM message_deletions md
         WHERE md.message_id=m.id AND md.user_id=?
       )`
  ).bind(user.id, sourceId, user.id).first();
  if (!source) return jsonError(c, 404, "???????????");
  const messageType = String(source.message_type);
  const isAttachment = messageType === "image" || messageType === "file" || messageType === "voice";
  if (isAttachment && !source.object_key) {
    return jsonError(c, 404, "????????");
  }
  const id = crypto.randomUUID();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const objectKey = isAttachment ? `${targetId}/${id}` : null;
  if (isAttachment) {
    const originalObject = await c.env.CHAT_IMAGES.get(source.object_key);
    if (!originalObject) return jsonError(c, 404, "????????");
    try {
      await c.env.CHAT_IMAGES.put(
        objectKey,
        await originalObject.arrayBuffer(),
        {
          httpMetadata: {
            contentType: source.mime_type || "application/octet-stream"
          }
        }
      );
    } catch (error) {
      console.error("Forward attachment copy failed:", error);
      return jsonError(c, 500, "??????");
    }
  }
  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO messages(
           id,conversation_id,sender_id,body,message_type,created_at,forwarded_from
         )
         SELECT ?,?,?,?,?,?,?
         WHERE EXISTS (
 SELECT 1
 FROM conversation_members cm
 JOIN users u ON u.id=cm.user_id
 WHERE cm.conversation_id=? AND cm.user_id=?
   AND u.status='active'
)`
      ).bind(
        id,
        targetId,
        user.id,
        source.body || "",
        messageType,
        createdAt,
        source.id,
        targetId,
        user.id
      ),
      ...isAttachment ? [
        c.env.DB.prepare(
          `INSERT INTO message_attachments(
             message_id,object_key,mime_type,file_name,file_size,duration_ms,created_at
           )
           SELECT ?,?,?,?,?,?,?
           WHERE EXISTS (
             SELECT 1 FROM messages
             WHERE id=? AND conversation_id=? AND sender_id=?
           )`
        ).bind(
          id,
          objectKey,
          source.mime_type || "application/octet-stream",
          source.file_name || (messageType === "image" ? "image" : "download"),
          Number(source.file_size || 0),
          Number(source.duration_ms || 0),
          createdAt,
          id,
          targetId,
          user.id
        )
      ] : []
    ]);
    if (!results[0]?.meta?.changes) {
      if (objectKey) await c.env.CHAT_IMAGES.delete(objectKey);
      return jsonError(c, 403, "?????????????");
    }
  } catch (error) {
    if (objectKey) {
      try {
        await c.env.CHAT_IMAGES.delete(objectKey);
      } catch {
      }
    }
    console.error("Forward message save failed:", error);
    return jsonError(c, 500, "??????");
  }
  try {
    const roomId = c.env.CHAT_ROOM.idFromName(targetId);
    const room = c.env.CHAT_ROOM.get(roomId);
    const endpoint = isAttachment ? "_internal/broadcast-message" : "_internal/broadcast-forwarded-message";
    const broadcast = await room.fetch(new Request(
      "https://chatroom.internal/" + endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: targetId,
          senderId: user.id,
          messageId: id,
          messageType,
          fileName: source.file_name || "",
          fileSize: Number(source.file_size || 0),
          durationMs: Number(source.duration_ms || 0),
          mimeType: source.mime_type || "",
          createdAt,
          forwardedFrom: source.id
        })
      }
    ));
    if (!broadcast.ok) {
      console.error("Forward broadcast failed:", broadcast.status);
    }
  } catch (error) {
    console.error("Forward broadcast failed:", error);
  }
  return c.json({ ok: true, id });
});
app.post("/api/conversations/:id/messages/bulk-delete", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const member = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(conversationId, user.id).first();
  if (!member) return jsonError(c, 403, "\u65E0\u6743\u64CD\u4F5C\u8BE5\u4F1A\u8BDD");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO message_deletions(message_id,user_id,deleted_at)
     SELECT id,?,? FROM messages WHERE conversation_id=?`
  ).bind(user.id, now, conversationId).run();
  return c.json({ ok: true });
});
app.post("/api/conversations/:id/messages/:messageId/delete", async (c) => {
  const user = c.get("user");
  const conversationId = c.req.param("id");
  const messageId = c.req.param("messageId");
  const member = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(conversationId, user.id).first();
  if (!member) return jsonError(c, 403, "\u65E0\u6743\u64CD\u4F5C\u8BE5\u4F1A\u8BDD");
  const message = await c.env.DB.prepare(
    "SELECT id FROM messages WHERE id=? AND conversation_id=?"
  ).bind(messageId, conversationId).first();
  if (!message) return jsonError(c, 404, "\u6D88\u606F\u4E0D\u5B58\u5728");
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO message_deletions(message_id,user_id,deleted_at) VALUES(?,?,?)"
  ).bind(messageId, user.id, (/* @__PURE__ */ new Date()).toISOString()).run();
  return c.json({ ok: true });
});
app.post("/api/conversations/:id/read", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const member = await c.env.DB.prepare(
    "SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?"
  ).bind(id, user.id).first();
  if (!member) return jsonError(c, 403, "???????");
  const readAt = (/* @__PURE__ */ new Date()).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO conversation_reads(conversation_id,user_id,last_read_at)
     VALUES(?,?,?)
     ON CONFLICT(conversation_id,user_id)
     DO UPDATE SET last_read_at=excluded.last_read_at`
  ).bind(id, user.id, readAt).run();
  return c.json({ ok: true, lastReadAt: readAt });
});
app.post("/api/presence/heartbeat", async (c) => {
  const u = c.get("user");
  await c.env.DB.prepare(
    "UPDATE users SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
  ).bind(u.id).run();
  return c.json({ ok: true });
});
app.get("/api/contacts", async (c) => {
  const u = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT u.id,u.username,u.display_name,u.avatar_url,u.last_seen_at,
       CASE WHEN u.last_seen_at IS NOT NULL
         AND julianday(u.last_seen_at)>=julianday('now','-60 seconds')
         THEN 1 ELSE 0 END AS is_online
     FROM friendships f JOIN users u ON u.id=f.friend_id
     WHERE f.user_id=? AND f.status='accepted'
       AND u.status='active'
       AND EXISTS (
         SELECT 1 FROM friendships reverse
         WHERE reverse.user_id=f.friend_id
           AND reverse.friend_id=f.user_id
           AND reverse.status='accepted'
       )
     ORDER BY u.display_name`
  ).bind(u.id).all();
  return c.json({ contacts: rows.results });
});
app.post("/api/contacts/request", async (c) => {
  const u = c.get("user"), b = await c.req.json().catch(() => ({}));
  const limitKey = "contact-request:" + u.id;
  if (await rateLimitBlocked(c, limitKey, 20, 3600)) {
    return jsonError(c, 429, "????????????????");
  }
  await recordRateLimit(c, limitKey, 3600);
  const target = await c.env.DB.prepare("SELECT id FROM users WHERE username=? AND status='active'").bind(b.username || "").first();
  if (!target || target.id === u.id) return jsonError(c, 404, "\u7528\u6237\u4E0D\u5B58\u5728");
  const requestResult = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO friendships(user_id,friend_id,status)
     SELECT ?,?,'pending'
     WHERE NOT EXISTS (
       SELECT 1 FROM friendships
       WHERE (
         (user_id=? AND friend_id=?)
         OR (user_id=? AND friend_id=?)
       )
       AND status IN ('accepted','blocked')
     )`
  ).bind(u.id, target.id, u.id, target.id, target.id, u.id).run();
  if (Number(requestResult.meta?.changes || 0) !== 1) {
    return jsonError(c, 409, "?????????????????");
  }
  return c.json({ ok: true, message: "\u597D\u53CB\u7533\u8BF7\u5DF2\u53D1\u9001" });
});
app.get("/api/contacts/requests", async (c) => {
  const u = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT f.user_id,u.username,u.display_name FROM friendships f JOIN users u ON u.id=f.user_id
     WHERE f.friend_id=? AND f.status='pending' AND u.status='active'`
  ).bind(u.id).all();
  return c.json({ requests: rows.results });
});
app.post("/api/contacts/accept", async (c) => {
  const u = c.get("user"), b = await c.req.json().catch(() => ({}));
  const requester = String(b.userId || "");
  if (!requester || requester === u.id) return jsonError(c, 400, "???????");
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE friendships SET status='accepted'
       WHERE user_id=? AND friend_id=? AND status='pending'
         AND EXISTS (
           SELECT 1 FROM users
           WHERE users.id=friendships.user_id AND users.status='active'
         )
         AND NOT EXISTS (
           SELECT 1 FROM friendships
           WHERE user_id=? AND friend_id=? AND status='blocked'
         )`
    ).bind(requester, u.id, u.id, requester),
    c.env.DB.prepare(
      `UPDATE friendships SET status='accepted'
       WHERE user_id=? AND friend_id=? AND status='pending'
         AND EXISTS (
           SELECT 1 FROM friendships
           WHERE user_id=? AND friend_id=? AND status='accepted'
         )`
    ).bind(u.id, requester, requester, u.id),
    c.env.DB.prepare(
      `INSERT INTO friendships(user_id,friend_id,status)
       SELECT ?,?,'accepted'
       WHERE EXISTS (
         SELECT 1 FROM friendships
         WHERE user_id=? AND friend_id=? AND status='accepted'
       )
       AND NOT EXISTS (
         SELECT 1 FROM friendships
         WHERE user_id=? AND friend_id=?
       )`
    ).bind(u.id, requester, requester, u.id, u.id, requester)
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    return jsonError(c, 409, "????????????????");
  }
  return c.json({ ok: true });
});
app.delete("/api/contacts/:id", async (c) => {
  const user = c.get("user");
  const friendId = String(c.req.param("id") || "").trim();
  if (!friendId || friendId === user.id) {
    return jsonError(c, 400, "\u65E0\u6548\u7684\u597D\u53CB");
  }
  const relation = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM friendships
     WHERE (
       (user_id=? AND friend_id=?)
       OR (user_id=? AND friend_id=?)
     )
     AND status='accepted'`
  ).bind(user.id, friendId, friendId, user.id).first();
  if (Number(relation?.total || 0) !== 2) {
    return jsonError(c, 404, "\u597D\u53CB\u5173\u7CFB\u4E0D\u5B58\u5728\u6216\u5C1A\u672A\u786E\u8BA4");
  }
  await c.env.DB.prepare(
    `DELETE FROM friendships
     WHERE (user_id=? AND friend_id=?)
        OR (user_id=? AND friend_id=?)`
  ).bind(user.id, friendId, friendId, user.id).run();
  return c.json({ ok: true, message: "\u5DF2\u5220\u9664\u597D\u53CB\uFF0C\u539F\u804A\u5929\u8BB0\u5F55\u5DF2\u4FDD\u7559" });
});
app.get("/api/admin/conversations/:id/attachments/:messageId", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "Forbidden");
  const conversationId = c.req.param("id");
  const messageId = c.req.param("messageId");
  const adminId = c.get("user").id;
  const reason = String(c.req.query("reason") || "").trim();
  if (reason.length < 3 || reason.length > 300) {
    return jsonError(c, 400, "A valid audit reason is required");
  }
  const row = await c.env.DB.prepare(
    "SELECT a.object_key,a.mime_type,a.file_name,a.file_size,a.duration_ms,m.message_type FROM messages m JOIN message_attachments a ON a.message_id=m.id WHERE m.id=? AND m.conversation_id=? AND m.message_type IN ('image','voice','file') LIMIT 1"
  ).bind(messageId, conversationId).first();
  if (!row) return jsonError(c, 404, "Attachment not found");
  const object = await c.env.CHAT_IMAGES.get(row.object_key);
  if (!object) return jsonError(c, 404, "Attachment object not found");
  const imageMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const audioMimes = ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"];
  let contentType = "application/octet-stream";
  if (row.message_type === "image" && imageMimes.includes(row.mime_type)) {
    contentType = row.mime_type;
  } else if (row.message_type === "voice" && audioMimes.includes(row.mime_type)) {
    contentType = row.mime_type;
  }
  const fileName = row.file_name || "attachment-" + messageId;
  const disposition = row.message_type === "image" || row.message_type === "voice" ? "inline" : "attachment";
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set(
    "Content-Disposition",
    disposition + `; filename="attachment"; filename*=UTF-8''` + encodeURIComponent(fileName)
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Content-Security-Policy", "default-src 'none'");
  await c.env.DB.prepare(
    "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
  ).bind(
    uuid(),
    adminId,
    "VIEW_CHAT_ATTACHMENT",
    messageId,
    JSON.stringify({
      conversationId,
      messageType: row.message_type,
      reason
    })
  ).run();
  return new Response(object.body, { status: 200, headers });
});
app.get("/api/admin/conversations/:id/messages", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "Forbidden");
  const id = c.req.param("id");
  const reason = String(c.req.query("reason") || "").trim();
  if (reason.length < 3 || reason.length > 300) {
    return jsonError(c, 400, "Review reason must be 3 to 300 characters");
  }
  await c.env.DB.prepare(
    "INSERT INTO admin_audit(id,admin_id,action,target_id,details) VALUES(?,?,?,?,?)"
  ).bind(
    uuid(),
    c.get("user").id,
    "VIEW_CHAT_HISTORY",
    id,
    JSON.stringify({ reason })
  ).run();
  const rows = await c.env.DB.prepare(
    `SELECT
       m.id,
       m.conversation_id,
       m.sender_id,
       m.body,
       m.message_type,
       m.created_at,
       m.recalled_at,
       u.username AS sender_username,
       u.display_name AS sender_display_name,
       u.avatar_url AS sender_avatar_url,
       a.file_name AS attachment_file_name,
       a.file_size AS attachment_file_size,
       a.mime_type AS attachment_mime_type,
       a.duration_ms AS attachment_duration_ms
     FROM messages m
     LEFT JOIN users u ON u.id = m.sender_id
     LEFT JOIN message_attachments a ON a.message_id = m.id
     WHERE m.conversation_id = ?
     ORDER BY m.created_at DESC
     LIMIT 500`
  ).bind(id).all();
  return c.json({ messages: rows.results });
});
app.get("/api/admin/audit", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const admin = String(c.req.query("admin") || "").trim().slice(0, 100);
  const action = String(c.req.query("action") || "").trim().slice(0, 80);
  const target = String(c.req.query("target") || "").trim().slice(0, 150);
  const startDate = String(c.req.query("startDate") || "").trim();
  const endDate = String(c.req.query("endDate") || "").trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (startDate && !datePattern.test(startDate) || endDate && !datePattern.test(endDate)) {
    return jsonError(c, 400, "\u65E5\u671F\u683C\u5F0F\u65E0\u6548");
  }
  if (startDate && endDate && startDate > endDate) {
    return jsonError(c, 400, "\u5F00\u59CB\u65E5\u671F\u4E0D\u80FD\u665A\u4E8E\u7ED3\u675F\u65E5\u671F");
  }
  let sql = "SELECT a.id,a.admin_id,a.action,a.target_id,a.details,a.created_at,COALESCE(u.display_name,u.username,a.admin_id) AS admin_name,u.username AS admin_username FROM admin_audit a LEFT JOIN users u ON u.id=a.admin_id LEFT JOIN users t ON t.id=a.target_id WHERE 1=1";
  const values = [];
  if (admin) {
    sql += " AND (u.username LIKE ? OR u.display_name LIKE ? OR a.admin_id LIKE ?)";
    const keyword = "%" + admin + "%";
    values.push(keyword, keyword, keyword);
  }
  if (action) {
    sql += " AND a.action=?";
    values.push(action);
  }
  if (target) {
    sql += " AND (a.target_id LIKE ? OR t.username LIKE ? OR t.display_name LIKE ?)";
    const keyword = "%" + target + "%";
    values.push(keyword, keyword, keyword);
  }
  if (startDate) {
    sql += " AND date(a.created_at)>=date(?)";
    values.push(startDate);
  }
  if (endDate) {
    sql += " AND date(a.created_at)<=date(?)";
    values.push(endDate);
  }
  sql += " ORDER BY a.created_at DESC LIMIT 500";
  const rows = await c.env.DB.prepare(sql).bind(...values).all();
  return c.json({ logs: rows.results });
});
app.get("/ws/calls", async (c) => {
  const origin = c.req.header("Origin");
  const fetchSite = c.req.header("Sec-Fetch-Site");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(c.req.url).origin) {
        return jsonError(c, 403, "WebSocket \u6765\u6E90\u4E0D\u5408\u6CD5");
      }
    } catch {
      return jsonError(c, 403, "WebSocket \u6765\u6E90\u4E0D\u5408\u6CD5");
    }
  } else if (fetchSite === "cross-site") {
    return jsonError(c, 403, "WebSocket \u6765\u6E90\u4E0D\u5408\u6CD5");
  }
  const user = await currentUser(c);
  if (!user) return jsonError(c, 401, "\u8BF7\u5148\u767B\u5F55");
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(c, 426, "\u9700\u8981 WebSocket");
  }
  const stub = c.env.CALL_ROOM.get(
    c.env.CALL_ROOM.idFromName(user.id)
  );
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-CloudChat-User", user.id);
  return stub.fetch(new Request(c.req.url, { headers }));
});
app.get("/ws/:conversationId", async (c) => {
  const origin = c.req.header("Origin");
  const fetchSite = c.req.header("Sec-Fetch-Site");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(c.req.url).origin) {
        return jsonError(c, 403, "WebSocket ????????");
      }
    } catch {
      return jsonError(c, 403, "WebSocket ??????");
    }
  } else if (fetchSite === "cross-site") {
    return jsonError(c, 403, "???? WebSocket ??");
  }
  const user = await currentUser(c);
  if (!user) return jsonError(c, 401, "\u8BF7\u5148\u767B\u5F55");
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return jsonError(c, 426, "\u9700\u8981 WebSocket");
  const id = c.env.CHAT_ROOM.idFromName(c.req.param("conversationId"));
  const stub = c.env.CHAT_ROOM.get(id);
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-CloudChat-User", user.id);
  return stub.fetch(new Request(c.req.url, { headers }));
});
var ChatRoom = class {
  static {
    __name(this, "ChatRoom");
  }
  state;
  env;
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  // 检查用户是否仍然属于该会话
  async isMember(conversationId, userId) {
    const member = await this.env.DB.prepare(
      `SELECT u.display_name
       FROM conversation_members cm
       JOIN users u ON u.id=cm.user_id
       WHERE cm.conversation_id=? AND cm.user_id=? AND u.status='active'`
    ).bind(conversationId, userId).first();
    return member || null;
  }
  // 成员被移除时由 /_internal/revoke-member 主动断开连接，这里不再逐连接查库
  async sendToCurrentMembers(conversationId, payload, excludeUserId) {
    for (const peer of this.state.getWebSockets()) {
      try {
        const meta = peer.deserializeAttachment();
        if (meta.conversationId !== conversationId) continue;
        if (excludeUserId && meta.userId === excludeUserId) continue;
        try {
          peer.send(payload);
        } catch {
        }
      } catch {
      }
    }
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/_internal/call-signal") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const body = await request.json().catch(() => null);
      const senderId = String(body?.userId || "");
      const conversationId2 = String(body?.conversationId || "");
      const data = body?.data;
      if (!senderId || !conversationId2 || conversationId2.length > 128 || !data || typeof data !== "object" || Array.isArray(data)) {
        return new Response("Invalid call signal", { status: 400 });
      }
      await this.handleCallSignal(
        senderId,
        conversationId2,
        data,
        (payload) => this.sendCallToUser(senderId, payload)
      );
      return Response.json({ ok: true });
    }
    if (url.pathname === "/_internal/close-room") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      let closed = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(JSON.stringify({ type: "conversation_deleted" }));
        } catch {
        }
        try {
          ws.close(4004, "conversation_deleted");
          closed++;
        } catch {
        }
      }
      return Response.json({ ok: true, closed });
    }
    if (url.pathname === "/_internal/revoke-member") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const conversationId2 = url.searchParams.get("conversationId") || "";
      const userId2 = url.searchParams.get("userId") || "";
      if (!conversationId2 || !userId2) {
        return new Response("Missing parameters", { status: 400 });
      }
      let closed = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          const meta = ws.deserializeAttachment();
          if (meta.conversationId === conversationId2 && meta.userId === userId2) {
            try {
              ws.send(JSON.stringify({
                type: "member_removed"
              }));
            } catch {
            }
            try {
              ws.close(4003, "removed");
              closed++;
            } catch {
            }
          }
        } catch {
        }
      }
      return Response.json({ ok: true, closed });
    }
    if (url.pathname === "/_internal/broadcast-forwarded-message") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const data = await request.json().catch(() => ({}));
      const conversationId2 = String(data.conversationId || "");
      const senderId = String(data.senderId || "");
      const messageId = String(data.messageId || "");
      if (!conversationId2 || !senderId || !messageId) {
        return new Response("Missing parameters", { status: 400 });
      }
      if (!await this.isMember(conversationId2, senderId)) {
        return new Response("Forbidden", { status: 403 });
      }
      const message = await this.env.DB.prepare(
        `SELECT m.id,m.body,m.created_at,m.forwarded_from,
                u.display_name AS sender_name
         FROM messages m
         JOIN users u ON u.id=m.sender_id
         WHERE m.id=? AND m.conversation_id=?
           AND m.sender_id=? AND m.message_type='text'`
      ).bind(messageId, conversationId2, senderId).first();
      if (!message) return new Response("Message not found", { status: 404 });
      await this.sendToCurrentMembers(conversationId2, JSON.stringify({
        type: "message",
        message: {
          id: message.id,
          conversationId: conversationId2,
          senderId,
          senderDisplayName: message.sender_name || "\u7FA4\u6210\u5458",
          body: message.body,
          createdAt: message.created_at,
          messageType: "text",
          forwardedFrom: message.forwarded_from
        }
      }));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/_internal/broadcast-message") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      let data;
      try {
        data = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const conversationId2 = String(data.conversationId || "");
      const senderId = String(data.senderId || "");
      const messageId = String(data.messageId || "");
      if (!conversationId2 || !senderId || !messageId) {
        return new Response("Missing parameters", { status: 400 });
      }
      if (!await this.isMember(conversationId2, senderId)) {
        return new Response("Forbidden", { status: 403 });
      }
      const messageType = String(data.messageType || "image");
      if (messageType !== "image" && messageType !== "file" && messageType !== "voice") {
        return new Response("Invalid message type", { status: 400 });
      }
      const saved = await this.env.DB.prepare(
        `SELECT m.id,m.body,m.forwarded_from FROM messages m
         JOIN message_attachments a ON a.message_id=m.id
         WHERE m.id=? AND m.conversation_id=?
           AND m.sender_id=? AND m.message_type=?`
      ).bind(messageId, conversationId2, senderId, messageType).first();
      if (!saved) return new Response("Image not found", { status: 404 });
      const sender = await this.env.DB.prepare(
        "SELECT display_name FROM users WHERE id=?"
      ).bind(senderId).first();
      await this.sendToCurrentMembers(conversationId2, JSON.stringify({
        type: "message",
        message: {
          id: messageId,
          conversationId: conversationId2,
          senderId,
          senderDisplayName: sender?.display_name || "\u7FA4\u6210\u5458",
          body: String(saved.body || ""),
          createdAt: String(data.createdAt || (/* @__PURE__ */ new Date()).toISOString()),
          forwardedFrom: saved.forwarded_from || null,
          messageType,
          fileName: String(data.fileName || "image"),
          fileSize: Number(data.fileSize || 0),
          durationMs: Number(data.durationMs || 0),
          mimeType: String(data.mimeType || "")
        }
      }));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/_internal/broadcast-red-envelope") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const data = await request.json().catch(() => ({}));
      const conversationId2 = String(data.conversationId || "");
      const senderId = String(data.senderId || "");
      const messageId = String(data.messageId || "");
      const envelopeId = String(data.envelopeId || "");
      if (!conversationId2 || !senderId || !messageId || !envelopeId) {
        return new Response("Missing parameters", { status: 400 });
      }
      if (!await this.isMember(conversationId2, senderId)) {
        return new Response("Forbidden", { status: 403 });
      }
      const row = await this.env.DB.prepare(
        `SELECT m.id,m.body,m.created_at,u.display_name AS sender_name,
                e.total_cents,e.remaining_cents,e.total_count,e.remaining_count,
                e.envelope_type,e.greeting,e.status,e.expires_at,e.sender_id
         FROM messages m
         JOIN red_envelopes e ON e.id=m.body
         JOIN users u ON u.id=m.sender_id
         WHERE m.id=? AND m.conversation_id=? AND m.sender_id=?
           AND m.message_type='red_envelope' AND e.id=?`
      ).bind(messageId, conversationId2, senderId, envelopeId).first();
      if (!row) return new Response("Red envelope not found", { status: 404 });
      await this.sendToCurrentMembers(conversationId2, JSON.stringify({
        type: "message",
        message: {
          id: row.id,
          conversationId: conversationId2,
          senderId,
          senderDisplayName: row.sender_name || "\u7FA4\u6210\u5458",
          body: row.body,
          createdAt: row.created_at,
          messageType: "red_envelope",
          redEnvelope: {
            id: envelopeId,
            totalCents: Number(row.total_cents),
            remainingCents: Number(row.remaining_cents),
            totalCount: Number(row.total_count),
            remainingCount: Number(row.remaining_count),
            envelopeType: row.envelope_type,
            greeting: row.greeting,
            status: row.status,
            expiresAt: Number(row.expires_at),
            senderId: row.sender_id
          }
        }
      }));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/_internal/broadcast-red-envelope-update") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const data = await request.json().catch(() => ({}));
      const conversationId2 = String(data.conversationId || "");
      const envelopeId = String(data.envelopeId || "");
      if (!conversationId2 || !envelopeId) {
        return new Response("Missing parameters", { status: 400 });
      }
      const row = await this.env.DB.prepare(
        `SELECT remaining_cents,remaining_count,status
         FROM red_envelopes WHERE id=? AND conversation_id=?`
      ).bind(envelopeId, conversationId2).first();
      if (!row) return new Response("Red envelope not found", { status: 404 });
      await this.sendToCurrentMembers(conversationId2, JSON.stringify({
        type: "red_envelope_update",
        envelopeId,
        remainingCents: Number(row.remaining_cents),
        remainingCount: Number(row.remaining_count),
        status: row.status
      }));
      return Response.json({ ok: true });
    }
    const userId = request.headers.get("X-CloudChat-User");
    const conversationId = url.pathname.split("/").pop() || "";
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }
    const member = await this.isMember(conversationId, userId);
    if (!member) {
      return new Response("Forbidden", { status: 403 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ userId, conversationId, displayName: member.display_name });
    this.state.acceptWebSocket(server);
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  // CLOUDCHAT_GLOBAL_CALL_ROOM_V1
  async sendCallToUser(userId, payload) {
    const stub = this.env.CALL_ROOM.get(
      this.env.CALL_ROOM.idFromName(userId)
    );
    const response = await stub.fetch(new Request(
      "https://callroom.internal/_internal/deliver",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, payload })
      }
    ));
    if (!response.ok) {
      throw new Error("Call delivery failed");
    }
  }
  async handleCallSignal(senderId, conversationId, data, sendToSender) {
    const callSignalTypes = /* @__PURE__ */ new Set([
      "call_invite",
      "call_accept",
      "call_reject",
      "call_cancel",
      "call_end",
      "webrtc_offer",
      "webrtc_answer",
      "webrtc_ice"
    ]);
    if (!data || !callSignalTypes.has(data.type)) return;
    const callId = String(data.callId || "");
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(callId)) return;
    const callStorageKey = "cloudchat_active_call_v1";
    await this.state.blockConcurrencyWhile(async () => {
      const sendCallError = /* @__PURE__ */ __name(async (message) => {
        try {
          await sendToSender(JSON.stringify({
            type: "call_error",
            callId,
            message
          }));
        } catch {
        }
      }, "sendCallError");
      const memberRows = await this.env.DB.prepare(
        `SELECT c.type AS conversation_type, cm.user_id
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id=c.id
         JOIN users u ON u.id=cm.user_id
         WHERE c.id=? AND u.status='active'`
      ).bind(conversationId).all();
      const members = memberRows.results || [];
      const totalRow = await this.env.DB.prepare(
        `SELECT COUNT(*) AS total_count
         FROM conversation_members
         WHERE conversation_id=?`
      ).bind(conversationId).first();
      if (members.length !== 2 || Number(totalRow?.total_count || 0) !== 2 || members.some((row) => row.conversation_type !== "direct") || !members.some((row) => row.user_id === senderId)) {
        await sendCallError("\u901A\u8BDD\u53EA\u652F\u6301\u53CC\u65B9\u5747\u6709\u6548\u7684\u4E00\u5BF9\u4E00\u597D\u53CB\u4F1A\u8BDD");
        return;
      }
      const peer = members.find((row) => row.user_id !== senderId);
      if (!peer) return;
      let currentCall = await this.state.storage.get(
        callStorageKey
      );
      const now = Date.now();
      if (currentCall) {
        const expired = currentCall.status === "ringing" ? now - currentCall.createdAt > 2 * 60 * 1e3 : now - (currentCall.acceptedAt || currentCall.createdAt) > 4 * 60 * 60 * 1e3;
        if (expired) {
          await this.state.storage.delete(callStorageKey);
          currentCall = void 0;
        }
      }
      const forward = /* @__PURE__ */ __name(async (payload) => {
        const message = JSON.stringify({
          ...payload,
          callId,
          fromUserId: senderId,
          conversationId
        });
        try {
          await this.sendCallToUser(peer.user_id, message);
        } catch (error) {
          console.error("Call delivery failed", error);
        }
      }, "forward");
      if (data.type === "call_invite") {
        const mode = data.mode;
        if (mode !== "audio" && mode !== "video") {
          await sendCallError("\u65E0\u6548\u7684\u901A\u8BDD\u7C7B\u578B");
          return;
        }
        if (currentCall) {
          await sendCallError("\u5F53\u524D\u4F1A\u8BDD\u6B63\u5728\u901A\u8BDD\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
          return;
        }
        const newCall = {
          callId,
          callerId: senderId,
          calleeId: peer.user_id,
          mode,
          status: "ringing",
          createdAt: now
        };
        await this.state.storage.put(callStorageKey, newCall);
        await forward({ type: "call_invite", mode });
        return;
      }
      if (!currentCall || currentCall.callId !== callId) {
        await sendCallError("\u901A\u8BDD\u4E0D\u5B58\u5728\u6216\u5DF2\u7ECF\u7ED3\u675F");
        return;
      }
      if (data.type === "call_accept") {
        if (senderId !== currentCall.calleeId || currentCall.status !== "ringing") {
          await sendCallError("\u5F53\u524D\u7528\u6237\u4E0D\u80FD\u63A5\u542C\u6B64\u901A\u8BDD");
          return;
        }
        currentCall.status = "active";
        currentCall.acceptedAt = now;
        await this.state.storage.put(callStorageKey, currentCall);
        await forward({
          type: "call_accept",
          mode: currentCall.mode
        });
        return;
      }
      if (data.type === "call_reject") {
        if (senderId !== currentCall.calleeId || currentCall.status !== "ringing") {
          await sendCallError("\u5F53\u524D\u7528\u6237\u4E0D\u80FD\u62D2\u7EDD\u6B64\u901A\u8BDD");
          return;
        }
        await this.state.storage.delete(callStorageKey);
        await forward({ type: "call_reject" });
        return;
      }
      if (data.type === "call_cancel") {
        if (senderId !== currentCall.callerId || currentCall.status !== "ringing") {
          await sendCallError("\u5F53\u524D\u7528\u6237\u4E0D\u80FD\u53D6\u6D88\u6B64\u901A\u8BDD");
          return;
        }
        await this.state.storage.delete(callStorageKey);
        await forward({ type: "call_cancel" });
        return;
      }
      if (data.type === "call_end") {
        if (currentCall.status !== "active" || ![currentCall.callerId, currentCall.calleeId].includes(senderId)) {
          await sendCallError("\u5F53\u524D\u901A\u8BDD\u5C1A\u672A\u63A5\u901A\u6216\u65E0\u6743\u6302\u65AD");
          return;
        }
        await this.state.storage.delete(callStorageKey);
        await forward({ type: "call_end" });
        return;
      }
      if (currentCall.status !== "active") {
        await sendCallError("\u901A\u8BDD\u5C1A\u672A\u63A5\u901A\uFF0C\u4E0D\u80FD\u4EA4\u6362\u5A92\u4F53\u4FE1\u4EE4");
        return;
      }
      if (data.type === "webrtc_offer") {
        if (senderId !== currentCall.callerId) {
          await sendCallError("\u53EA\u6709\u547C\u53EB\u65B9\u53EF\u4EE5\u53D1\u9001 offer");
          return;
        }
        const description = data.description;
        if (!description || typeof description !== "object" || description.type !== "offer" || typeof description.sdp !== "string" || description.sdp.length === 0 || description.sdp.length > 100 * 1024) return;
        await forward({
          type: "webrtc_offer",
          description: {
            type: "offer",
            sdp: description.sdp
          }
        });
        return;
      }
      if (data.type === "webrtc_answer") {
        if (senderId !== currentCall.calleeId) {
          await sendCallError("\u53EA\u6709\u63A5\u542C\u65B9\u53EF\u4EE5\u53D1\u9001 answer");
          return;
        }
        const description = data.description;
        if (!description || typeof description !== "object" || description.type !== "answer" || typeof description.sdp !== "string" || description.sdp.length === 0 || description.sdp.length > 100 * 1024) return;
        await forward({
          type: "webrtc_answer",
          description: {
            type: "answer",
            sdp: description.sdp
          }
        });
        return;
      }
      if (data.type === "webrtc_ice") {
        if (![currentCall.callerId, currentCall.calleeId].includes(senderId)) return;
        const candidate = data.candidate;
        if (!candidate || typeof candidate !== "object" || typeof candidate.candidate !== "string" || candidate.candidate.length === 0 || candidate.candidate.length > 4096) return;
        await forward({
          type: "webrtc_ice",
          candidate: {
            candidate: candidate.candidate,
            sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid.slice(0, 128) : null,
            sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex) ? candidate.sdpMLineIndex : null,
            usernameFragment: typeof candidate.usernameFragment === "string" ? candidate.usernameFragment.slice(0, 256) : null
          }
        });
      }
    });
  }
  async webSocketMessage(ws, message) {
    const MAX_CALL_SIGNAL_BYTES = 128 * 1024;
    const incomingBytes = typeof message === "string" ? new TextEncoder().encode(message).byteLength : message.byteLength;
    if (incomingBytes > MAX_CALL_SIGNAL_BYTES) {
      try {
        ws.close(1009, "message too large");
      } catch {
      }
      return;
    }
    const rawMessage = typeof message === "string" ? message : new TextDecoder().decode(message);
    const attachment = ws.deserializeAttachment();
    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch {
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const callSignalTypes = /* @__PURE__ */ new Set([
      "call_invite",
      "call_accept",
      "call_reject",
      "call_cancel",
      "call_end",
      "webrtc_offer",
      "webrtc_answer",
      "webrtc_ice"
    ]);
    if (callSignalTypes.has(data.type)) {
      await this.handleCallSignal(
        attachment.userId,
        attachment.conversationId,
        data,
        (payload2) => {
          try {
            ws.send(payload2);
          } catch {
          }
        }
      );
      return;
    }
    if (incomingBytes > 16 * 1024) {
      try {
        ws.close(1009, "message too large");
      } catch {
      }
      return;
    }
    const isTextMessage = data.type === void 0 || data.type === "message";
    if (!isTextMessage && !["typing", "stop_typing", "recall"].includes(data.type)) {
      return;
    }
    if (data.type === "typing" || data.type === "stop_typing") {
      const payload2 = JSON.stringify({
        type: data.type,
        userId: attachment.userId
      });
      await this.sendToCurrentMembers(
        attachment.conversationId,
        payload2,
        attachment.userId
      );
      return;
    }
    if (data.type === "recall") {
      const messageId = String(data.messageId || "").slice(0, 100);
      if (!messageId) return;
      const messageRow = await this.env.DB.prepare(
        "SELECT id,sender_id,created_at,recalled_at,message_type,body FROM messages WHERE id=? AND conversation_id=?"
      ).bind(messageId, attachment.conversationId).first();
      if (!messageRow || messageRow.sender_id !== attachment.userId || messageRow.recalled_at) {
        try {
          ws.send(JSON.stringify({
            type: "recall_error",
            message: "\u53EA\u80FD\u64A4\u56DE\u81EA\u5DF1\u5C1A\u672A\u64A4\u56DE\u7684\u6D88\u606F"
          }));
        } catch {
        }
        return;
      }
      const createdAt2 = new Date(messageRow.created_at).getTime();
      if (!Number.isFinite(createdAt2) || Date.now() - createdAt2 > 12e4 || Date.now() < createdAt2) {
        try {
          ws.send(JSON.stringify({
            type: "recall_error",
            message: "\u6D88\u606F\u53D1\u9001\u8D85\u8FC7\u4E24\u5206\u949F\uFF0C\u4E0D\u80FD\u64A4\u56DE"
          }));
        } catch {
        }
        return;
      }
      const recalledAt = (/* @__PURE__ */ new Date()).toISOString();
      const updateResult = await this.env.DB.prepare(
        `UPDATE messages
         SET recalled_at=?
         WHERE id=?
           AND conversation_id=?
           AND sender_id=?
           AND recalled_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM conversation_members cm
             JOIN users u ON u.id=cm.user_id
             WHERE cm.conversation_id=? AND cm.user_id=?
               AND u.status='active'
           )`
      ).bind(
        recalledAt,
        messageId,
        attachment.conversationId,
        attachment.userId,
        attachment.conversationId,
        attachment.userId
      ).run();
      if (!updateResult.meta.changes) return;
      const payload2 = JSON.stringify({
        type: "message_recalled",
        messageId,
        senderId: attachment.userId,
        recalledAt
      });
      await this.sendToCurrentMembers(
        attachment.conversationId,
        payload2
      );
      return;
    }
    if (typeof data.body !== "string") return;
    const body = data.body.trim().slice(0, 5e3);
    if (!body) return;
    const replyTo = typeof data.replyTo === "string" ? data.replyTo.slice(0, 100) : null;
    const id = crypto.randomUUID();
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    const insertResult = await this.env.DB.prepare(
      `INSERT INTO messages(
        id,conversation_id,sender_id,body,message_type,created_at,reply_to
      )
      SELECT ?,?,?,?,'text',?,?
      WHERE EXISTS (
        SELECT 1
        FROM conversation_members cm
        JOIN users u ON u.id=cm.user_id
        WHERE cm.conversation_id=? AND cm.user_id=?
          AND u.status='active'
      )`
    ).bind(
      id,
      attachment.conversationId,
      attachment.userId,
      body,
      createdAt,
      replyTo,
      attachment.conversationId,
      attachment.userId
    ).run();
    if (!insertResult.meta.changes) {
      try {
        ws.close(4003, "removed");
      } catch {
      }
      return;
    }
    const payload = JSON.stringify({
      type: "message",
      message: {
        id,
        conversationId: attachment.conversationId,
        senderId: attachment.userId,
        senderDisplayName: attachment.displayName || "\u7FA4\u6210\u5458",
        body,
        createdAt,
        replyTo
      }
    });
    await this.sendToCurrentMembers(
      attachment.conversationId,
      payload
    );
  }
  async webSocketClose(ws, code, reason) {
    try {
      const attachment = ws.deserializeAttachment();
      const payload = JSON.stringify({
        type: "stop_typing",
        userId: attachment.userId
      });
      await this.sendToCurrentMembers(
        attachment.conversationId,
        payload,
        attachment.userId
      );
    } catch {
    }
    try {
      ws.close(code, reason);
    } catch {
    }
  }
  async webSocketError(ws) {
    try {
      ws.close(1011, "connection error");
    } catch {
    }
  }
};
var CallRoom = class {
  static {
    __name(this, "CallRoom");
  }
  state;
  env;
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/_internal/deliver") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const body = await request.json().catch(() => null);
      const userId2 = String(body?.userId || "");
      const payload = body?.payload;
      if (!userId2 || typeof payload !== "string" || payload.length > 140 * 1024) {
        return new Response("Invalid delivery", { status: 400 });
      }
      let delivered = 0;
      for (const peer of this.state.getWebSockets()) {
        try {
          const attachment = peer.deserializeAttachment();
          if (attachment?.userId !== userId2) continue;
          peer.send(payload);
          delivered++;
        } catch {
        }
      }
      return Response.json({ ok: true, delivered });
    }
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }
    const userId = request.headers.get("X-CloudChat-User");
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ userId });
    this.state.acceptWebSocket(server);
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  async webSocketMessage(ws, message) {
    const size = typeof message === "string" ? new TextEncoder().encode(message).byteLength : message.byteLength;
    if (size > 128 * 1024) {
      try {
        ws.close(1009, "message too large");
      } catch {
      }
      return;
    }
    const attachment = ws.deserializeAttachment();
    let data;
    try {
      data = JSON.parse(
        typeof message === "string" ? message : new TextDecoder().decode(message)
      );
    } catch {
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const conversationId = String(data.conversationId || "");
    if (!conversationId || conversationId.length > 128) return;
    const allowedTypes = /* @__PURE__ */ new Set([
      "call_invite",
      "call_accept",
      "call_reject",
      "call_cancel",
      "call_end",
      "webrtc_offer",
      "webrtc_answer",
      "webrtc_ice"
    ]);
    if (!allowedTypes.has(data.type)) return;
    const stub = this.env.CHAT_ROOM.get(
      this.env.CHAT_ROOM.idFromName(conversationId)
    );
    try {
      const response = await stub.fetch(new Request(
        "https://chatroom.internal/_internal/call-signal",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: attachment.userId,
            conversationId,
            data
          })
        }
      ));
      if (!response.ok) {
        ws.send(JSON.stringify({
          type: "call_error",
          callId: String(data.callId || ""),
          message: "\u901A\u8BDD\u4FE1\u4EE4\u5904\u7406\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5"
        }));
      }
    } catch {
      try {
        ws.send(JSON.stringify({
          type: "call_error",
          callId: String(data.callId || ""),
          message: "\u901A\u8BDD\u670D\u52A1\u5668\u6682\u65F6\u4E0D\u53EF\u7528"
        }));
      } catch {
      }
    }
  }
  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
    }
  }
  async webSocketError(ws) {
    try {
      ws.close(1011, "connection error");
    } catch {
    }
  }
};
app.get("/api/admin/storage/audit", async (c) => {
  if (!requireAdmin(c)) return jsonError(c, 403, "\u65E0\u7BA1\u7406\u5458\u6743\u9650");
  const MAX_SCAN = 1e3;
  const SAMPLE_LIMIT = 100;
  try {
    const r2Objects = [];
    let cursor;
    let r2Truncated = false;
    do {
      const page = await c.env.CHAT_IMAGES.list({
        limit: Math.min(1e3, MAX_SCAN - r2Objects.length),
        ...cursor ? { cursor } : {}
      });
      for (const object of page.objects) {
        r2Objects.push(object.key);
      }
      if (!page.truncated) break;
      if (r2Objects.length >= MAX_SCAN) {
        r2Truncated = true;
        break;
      }
      if (!page.cursor) {
        throw new Error("R2 listing cursor missing");
      }
      cursor = page.cursor;
    } while (true);
    const attachmentRows = await c.env.DB.prepare(
      "SELECT object_key FROM message_attachments ORDER BY object_key LIMIT ?"
    ).bind(MAX_SCAN + 1).all();
    const dbRows = attachmentRows.results || [];
    const dbTruncated = dbRows.length > MAX_SCAN;
    const dbKeys = dbRows.slice(0, MAX_SCAN).map((row) => row.object_key);
    const dbKeySet = new Set(dbKeys);
    const orphanObjects = [];
    const r2Keys = [...new Set(r2Objects)];
    for (let i = 0; i < r2Keys.length; i += 80) {
      const chunk = r2Keys.slice(i, i + 80);
      if (!chunk.length) continue;
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await c.env.DB.prepare(
        `SELECT object_key FROM message_attachments WHERE object_key IN (${placeholders})`
      ).bind(...chunk).all();
      const existing = new Set(
        (rows.results || []).map((row) => row.object_key)
      );
      for (const key of chunk) {
        if (!existing.has(key)) orphanObjects.push(key);
      }
    }
    const missingObjects = [];
    for (let i = 0; i < dbKeys.length; i += 25) {
      const chunk = dbKeys.slice(i, i + 25);
      const results = await Promise.all(
        chunk.map(async (key) => ({
          key,
          object: await c.env.CHAT_IMAGES.head(key)
        }))
      );
      for (const result of results) {
        if (!result.object) missingObjects.push(result.key);
      }
    }
    return c.json({
      ok: true,
      readOnly: true,
      truncated: r2Truncated || dbTruncated,
      summary: {
        r2ObjectsScanned: r2Objects.length,
        databaseAttachmentsScanned: dbKeys.length,
        orphanObjectCount: orphanObjects.length,
        missingObjectCount: missingObjects.length
      },
      orphanObjects: orphanObjects.slice(0, SAMPLE_LIMIT),
      missingObjects: missingObjects.slice(0, SAMPLE_LIMIT)
    });
  } catch (error) {
    console.error("Storage audit failed:", error);
    return jsonError(c, 500, "Storage audit failed");
  }
});
app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));
var index_default = app;
export {
  CallRoom,
  ChatRoom,
  index_default as default
};
