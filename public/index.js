const equalFn = (a, b) => a === b;

const $PROXY = Symbol("solid-proxy");
const signalOptions = {
  equals: equalFn
};
let runEffects = runQueue;
const NOTPENDING = {};
const STALE = 1;
const PENDING = 2;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
const [transPending, setTransPending] = /*@__PURE__*/createSignal(false);
var Owner = null;
let Transition = null;
let Listener = null;
let Pending = null;
let Updates = null;
let Effects = null;
let ExecCount = 0;
let rootCount = 0;

function createRoot(fn, detachedOwner) {
  detachedOwner && (Owner = detachedOwner);
  const listener = Listener,
        owner = Owner,
        root = fn.length === 0 && !"_SOLID_DEV_" ? UNOWNED : {
    owned: null,
    cleanups: null,
    context: null,
    owner,
    attached: !!detachedOwner
  };
  if (owner) root.name = `${owner.name}-r${rootCount++}`;
  Owner = root;
  Listener = null;
  let result;

  try {
    runUpdates(() => result = fn(() => cleanNode(root)), true);
  } finally {
    Listener = listener;
    Owner = owner;
  }

  return result;
}

function createSignal(value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value,
    observers: null,
    observerSlots: null,
    pending: NOTPENDING,
    comparator: options.equals || undefined
  };
  s.name = registerGraph(options && options.name || hashValue(value), s);
  return [readSignal.bind(s), value => {
    if (typeof value === "function") {
      value = value(s.pending !== NOTPENDING ? s.pending : s.value);
    }

    return writeSignal(s, value);
  }];
}

function createComputed(fn, value, options) {
  updateComputation(createComputation(fn, value, true, options));
}

function createRenderEffect(fn, value, options) {
  updateComputation(createComputation(fn, value, false, options));
}

function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true, options);
  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  c.state = 0;
  c.comparator = options.equals || undefined;
  updateComputation(c);
  return readSignal.bind(c);
}

function createResource(source, fetcher, options = {}) {
  if (arguments.length === 2) {
    if (typeof fetcher === "object") {
      options = fetcher;
      fetcher = source;
      source = true;
    }
  } else if (arguments.length === 1) {
    fetcher = source;
    source = true;
  }

  const contexts = new Set(),
        [s, set] = createSignal(options.initialValue),
        [track, trigger] = createSignal(undefined, {
    equals: false
  }),
        [loading, setLoading] = createSignal(false),
        [error, setError] = createSignal();
  let err = undefined,
      pr = null,
      initP = null,
      dynamic = typeof source === "function";

  function loadEnd(p, v, e) {
    if (pr === p) {
      setError(err = e);
      pr = null;

      completeLoad(v);
    }

    return v;
  }

  function completeLoad(v) {
    batch(() => {
      set(() => v);
      setLoading(false);

      for (const c of contexts.keys()) c.decrement();

      contexts.clear();
    });
  }

  function read() {
    const c = SuspenseContext ,
          v = s();
    if (err) throw err;

    if (Listener && !Listener.user && c) {
      createComputed(() => {
        track();

        if (pr) {
          if (c.resolved ) ;else if (!contexts.has(c)) {
            c.increment();
            contexts.add(c);
          }
        }
      });
    }

    return v;
  }

  function load() {
    setError(err = undefined);
    const lookup = dynamic ? source() : source;

    if (lookup == null || lookup === false) {
      loadEnd(pr, untrack(s));
      return;
    }
    const p = initP || untrack(() => fetcher(lookup, s));
    initP = null;

    if (typeof p !== "object" || !("then" in p)) {
      loadEnd(pr, p);
      return;
    }

    pr = p;
    batch(() => {
      setLoading(true);
      trigger();
    });
    p.then(v => loadEnd(p, v), e => loadEnd(p, e, e));
  }

  Object.defineProperties(read, {
    loading: {
      get() {
        return loading();
      }

    },
    error: {
      get() {
        return error();
      }

    }
  });
  if (dynamic) createComputed(load);else load();
  return [read, {
    refetch: load,
    mutate: set
  }];
}

function batch(fn) {
  if (Pending) return fn();
  let result;
  const q = Pending = [];

  try {
    result = fn();
  } finally {
    Pending = null;
  }

  runUpdates(() => {
    for (let i = 0; i < q.length; i += 1) {
      const data = q[i];

      if (data.pending !== NOTPENDING) {
        const pending = data.pending;
        data.pending = NOTPENDING;
        writeSignal(data, pending);
      }
    }
  }, false);
  return result;
}

function untrack(fn) {
  let result,
      listener = Listener;
  Listener = null;
  result = fn();
  Listener = listener;
  return result;
}

function onCleanup(fn) {
  if (Owner === null) console.warn("cleanups created outside a `createRoot` or `render` will never be run");else if (Owner.cleanups === null) Owner.cleanups = [fn];else Owner.cleanups.push(fn);
  return fn;
}

function getListener() {
  return Listener;
}

function useTransition() {
  return [transPending, (fn, cb) => {

    batch(fn);
    if (cb) cb();
  }];
}

function devComponent(Comp, props) {
  const c = createComputation(() => untrack(() => Comp(props)), undefined, true);
  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  c.state = 0;
  c.componentName = Comp.name;
  updateComputation(c);
  return c.tValue !== undefined ? c.tValue : c.value;
}

function hashValue(v) {
  const s = new Set();
  return `s${typeof v === "string" ? hash(v) : hash(JSON.stringify(v, (k, v) => {
    if (typeof v === "object" && v != null) {
      if (s.has(v)) return;
      s.add(v);
    }

    return v;
  }) || "")}`;
}

function registerGraph(name, value) {
  let tryName = name;

  if (Owner) {
    let i = 0;
    Owner.sourceMap || (Owner.sourceMap = {});

    while (Owner.sourceMap[tryName]) tryName = `${name}-${++i}`;

    Owner.sourceMap[tryName] = value;
  }

  return tryName;
}

function createContext(defaultValue) {
  const id = Symbol("context");
  return {
    id,
    Provider: createProvider(id),
    defaultValue
  };
}

function useContext(context) {
  return lookup(Owner, context.id) || context.defaultValue;
}

function children(fn) {
  const children = createMemo(fn);
  return createMemo(() => resolveChildren(children()));
}

let SuspenseContext;

function readSignal() {
  if (this.state && this.sources) {
    const updates = Updates;
    Updates = null;
    this.state === STALE ? updateComputation(this) : lookDownstream(this);
    Updates = updates;
  }

  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;

    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots.push(sSlot);
    }

    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots.push(Listener.sources.length - 1);
    }
  }
  return this.value;
}

function writeSignal(node, value, isComp) {
  if (node.comparator) {
    if (node.comparator(node.value, value)) return value;
  }

  if (Pending) {
    if (node.pending === NOTPENDING) Pending.push(node);
    node.pending = value;
    return value;
  }

  node.value = value;

  if (node.observers && (!Updates || node.observers.length)) {
    runUpdates(() => {
      for (let i = 0; i < node.observers.length; i += 1) {
        const o = node.observers[i];
        if (Transition && Transition.running && Transition.disposed.has(o)) ;
        if (o.observers && o.state !== PENDING) markUpstream(o);
        o.state = STALE;
        if (o.pure) Updates.push(o);else Effects.push(o);
      }

      if (Updates.length > 10e5) {
        Updates = [];
        if ("_SOLID_DEV_") throw new Error("Potential Infinite Loop Detected.");
        throw new Error();
      }
    }, false);
  }

  return value;
}

function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  const owner = Owner,
        listener = Listener,
        time = ExecCount;
  Listener = Owner = node;
  runComputation(node, node.value, time);

  Listener = listener;
  Owner = owner;
}

function runComputation(node, value, time) {
  let nextValue;

  try {
    nextValue = node.fn(value);
  } catch (err) {
    handleError(err);
  }

  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.observers && node.observers.length) {
      writeSignal(node, nextValue);
    } else node.value = nextValue;

    node.updatedAt = time;
  }
}

function createComputation(fn, init, pure, options) {
  const c = {
    fn,
    state: STALE,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: null,
    pure
  };
  if (Owner === null) console.warn("computations created outside a `createRoot` or `render` will never be disposed");else if (Owner !== UNOWNED) {
    {
      if (!Owner.owned) Owner.owned = [c];else Owner.owned.push(c);
    }

    c.name = options && options.name || `${Owner.name || "c"}-${(Owner.owned || Owner.tOwned).length}`;
  }
  return c;
}

function runTop(node) {
  let top = node.state === STALE && node,
      pending;
  if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
  const runningTransition = Transition ;

  while ((node.fn || runningTransition ) && (node = node.owner)) {
    if (node.state === PENDING) pending = node;else if (node.state === STALE) {
      top = node;
      pending = undefined;
    }
  }

  if (pending) {
    const updates = Updates;
    Updates = null;
    lookDownstream(pending);
    Updates = updates;
    if (!top || top.state !== STALE) return;
  }

  top && updateComputation(top);
}

function runUpdates(fn, init) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;else Effects = [];
  ExecCount++;

  try {
    fn();
  } catch (err) {
    handleError(err);
  } finally {
    completeUpdates(wait);
  }
}

function completeUpdates(wait) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }

  if (wait) return;

  if (Effects.length) batch(() => {
    runEffects(Effects);
    Effects = null;
  });else {
    Effects = null;
    globalThis._$afterUpdate && globalThis._$afterUpdate();
  }
}

function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}

function lookDownstream(node) {
  node.state = 0;

  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];

    if (source.sources) {
      if (source.state === STALE) runTop(source);else if (source.state === PENDING) lookDownstream(source);
    }
  }
}

function markUpstream(node) {
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];

    if (!o.state) {
      o.state = PENDING;
      o.observers && markUpstream(o);
    }
  }
}

function cleanNode(node) {
  let i;

  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(),
            index = node.sourceSlots.pop(),
            obs = source.observers;

      if (obs && obs.length) {
        const n = obs.pop(),
              s = source.observerSlots.pop();

        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
    }
  }

  if (node.owned) {
    for (i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);

    node.owned = null;
  }

  if (node.cleanups) {
    for (i = 0; i < node.cleanups.length; i++) node.cleanups[i]();

    node.cleanups = null;
  }

  node.state = 0;
  node.context = null;
}

function handleError(err) {
  throw err;
}

function lookup(owner, key) {
  return owner && (owner.context && owner.context[key] || owner.owner && lookup(owner.owner, key));
}

function resolveChildren(children) {
  if (typeof children === "function" && !children.length) return resolveChildren(children());

  if (Array.isArray(children)) {
    const results = [];

    for (let i = 0; i < children.length; i++) {
      const result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }

    return results;
  }

  return children;
}

function createProvider(id) {
  return function provider(props) {
    let res;
    createComputed(() => res = untrack(() => {
      Owner.context = {
        [id]: props.value
      };
      return children(() => props.children);
    }));
    return res;
  };
}

function hash(s) {
  for (var i = 0, h = 9; i < s.length;) h = Math.imul(h ^ s.charCodeAt(i++), 9 ** 9);

  return `${h ^ h >>> 9}`;
}

const FALLBACK = Symbol("fallback");

function dispose(d) {
  for (let i = 0; i < d.length; i++) d[i]();
}

function mapArray(list, mapFn, options = {}) {
  let items = [],
      mapped = [],
      disposers = [],
      len = 0,
      indexes = mapFn.length > 1 ? [] : null,
      ctx = Owner;
  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [],
        i,
        j;
    return untrack(() => {
      let newLen = newItems.length,
          newIndices,
          newIndicesNext,
          temp,
          tempdisposers,
          tempIndexes,
          start,
          end,
          newEnd,
          item;

      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }

        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback();
          }, ctx);
          len = 1;
        }
      } else if (len === 0) {
        mapped = new Array(newLen);

        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper, ctx);
        }

        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));

        for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++);

        for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes[newEnd] = indexes[end]);
        }

        newIndices = new Map();
        newIndicesNext = new Array(newEnd + 1);

        for (j = newEnd; j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item);
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(item, j);
        }

        for (i = start; i <= end; i++) {
          item = items[i];
          j = newIndices.get(item);

          if (j !== undefined && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes[j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }

        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];

            if (indexes) {
              indexes[j] = tempIndexes[j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper, ctx);
        }

        mapped = mapped.slice(0, len = newLen);
        items = newItems.slice(0);
      }

      return mapped;
    });

    function mapper(disposer) {
      disposers[j] = disposer;

      if (indexes) {
        const [s, set] = createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }

      return mapFn(newItems[j]);
    }
  };
}

function createComponent(Comp, props) {

  return devComponent(Comp, props);
}

function trueFn() {
  return true;
}

const propTraps = {
  get(_, property, receiver) {
    if (property === $PROXY) return receiver;
    return _.get(property);
  },

  has(_, property) {
    return _.has(property);
  },

  set: trueFn,
  deleteProperty: trueFn,

  getOwnPropertyDescriptor(_, property) {
    return {
      configurable: true,
      enumerable: true,

      get() {
        return _.get(property);
      },

      set: trueFn,
      deleteProperty: trueFn
    };
  },

  ownKeys(_) {
    return _.keys();
  }

};

function mergeProps(...sources) {
  return new Proxy({
    get(property) {
      for (let i = sources.length - 1; i >= 0; i--) {
        const v = sources[i][property];
        if (v !== undefined) return v;
      }
    },

    has(property) {
      for (let i = sources.length - 1; i >= 0; i--) {
        if (property in sources[i]) return true;
      }

      return false;
    },

    keys() {
      const keys = [];

      for (let i = 0; i < sources.length; i++) keys.push(...Object.keys(sources[i]));

      return [...new Set(keys)];
    }

  }, propTraps);
}

function lazy(fn) {
  let p;

  const wrap = props => {
    let comp;

    {
      const [s] = createResource(() => (p || (p = fn())).then(mod => mod.default));
      comp = s;
    }

    let Comp;
    return createMemo(() => (Comp = comp()) && untrack(() => {
      return Comp(props);
    }));
  };

  wrap.preload = () => (p || (p = fn())).then(mod => mod.default);

  return wrap;
}

function For(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(mapArray(() => props.each, props.children, fallback ? fallback : undefined));
}

function Show(props) {
  let strictEqual = false;
  const condition = createMemo(() => props.when, undefined, {
    equals: (a, b) => strictEqual ? a === b : !a === !b
  });
  return createMemo(() => {
    const c = condition();

    if (c) {
      const child = props.children;
      return (strictEqual = typeof child === "function" && child.length > 0) ? untrack(() => child(c)) : child;
    }

    return props.fallback;
  });
}

if (globalThis) {
  if (!globalThis.Solid$$) globalThis.Solid$$ = true;else console.warn("You appear to have multiple instances of Solid. This can lead to unexpected behavior.");
}

const booleans = ["allowfullscreen", "allowpaymentrequest", "async", "autofocus", "autoplay", "checked", "controls", "default", "disabled", "formnovalidate", "hidden", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "seamless", "selected", "truespeed"];
const Properties = new Set(["className", "indeterminate", "value", ...booleans]);
const ChildProperties = new Set(["innerHTML", "textContent", "innerText", "children"]);
const Aliases = {
  className: "class",
  htmlFor: "for"
};
const DelegatedEvents = new Set(["beforeinput", "click", "dblclick", "focusin", "focusout", "input", "keydown", "keyup", "mousedown", "mousemove", "mouseout", "mouseover", "mouseup", "pointerdown", "pointermove", "pointerout", "pointerover", "pointerup", "touchend", "touchmove", "touchstart"]);
const SVGNamespace = {
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};

function memo(fn, equals) {
  return createMemo(fn, undefined, !equals ? {
    equals
  } : undefined);
}

function reconcileArrays(parentNode, a, b) {
  let bLength = b.length,
      aEnd = a.length,
      bEnd = bLength,
      aStart = 0,
      bStart = 0,
      after = a[aEnd - 1].nextSibling,
      map = null;

  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }

    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }

    if (aEnd === aStart) {
      const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;

      while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) parentNode.removeChild(a[aStart]);
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);
      a[aEnd] = b[bEnd];
    } else {
      if (!map) {
        map = new Map();
        let i = bStart;

        while (i < bEnd) map.set(b[i], i++);
      }

      const index = map.get(a[aStart]);

      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
              sequence = 1,
              t;

          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }

          if (sequence > index - bStart) {
            const node = a[aStart];

            while (bStart < index) parentNode.insertBefore(b[bStart++], node);
          } else parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else aStart++;
      } else parentNode.removeChild(a[aStart++]);
    }
  }
}

const $$EVENTS = Symbol("delegated-events");

function render(code, element, init) {
  let disposer;
  createRoot(dispose => {
    disposer = dispose;
    insert(element, code(), element.firstChild ? null : undefined, init);
  });
  return () => {
    disposer();
    element.textContent = "";
  };
}

function template(html, check, isSVG) {
  const t = document.createElement("template");
  t.innerHTML = html;
  let node = t.content.firstChild;
  if (isSVG) node = node.firstChild;
  return node;
}

function delegateEvents(eventNames, document = window.document) {
  const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());

  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];

    if (!e.has(name)) {
      e.add(name);
      document.addEventListener(name, eventHandler);
    }
  }
}

function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name);else node.setAttribute(name, value);
}

function setAttributeNS(node, namespace, name, value) {
  if (value == null) node.removeAttributeNS(namespace, name);else node.setAttributeNS(namespace, name, value);
}

function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    node.addEventListener(name, e => handler[0](handler[1], e));
  } else node.addEventListener(name, handler);
}

function classList(node, value, prev = {}) {
  const classKeys = Object.keys(value),
        prevKeys = Object.keys(prev);
  let i, len;

  for (i = 0, len = prevKeys.length; i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || key in value) continue;
    toggleClassKey(node, key, false);
    delete prev[key];
  }

  for (i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
          classValue = !!value[key];
    if (!key || key === "undefined" || prev[key] === classValue) continue;
    toggleClassKey(node, key, classValue);
    prev[key] = classValue;
  }

  return prev;
}

function style(node, value, prev = {}) {
  const nodeStyle = node.style;
  if (typeof value === "string") return nodeStyle.cssText = value;
  typeof prev === "string" && (prev = {});
  let v, s;

  for (s in prev) {
    value[s] == null && nodeStyle.removeProperty(s);
    delete prev[s];
  }

  for (s in value) {
    v = value[s];

    if (v !== prev[s]) {
      nodeStyle.setProperty(s, v);
      prev[s] = v;
    }
  }

  return prev;
}

function spread(node, accessor, isSVG, skipChildren) {
  if (typeof accessor === "function") {
    createRenderEffect(current => spreadExpression(node, accessor(), current, isSVG, skipChildren));
  } else spreadExpression(node, accessor, undefined, isSVG, skipChildren);
}

function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  createRenderEffect(current => insertExpression(parent, accessor(), current, marker), initial);
}

function assign(node, props, isSVG, skipChildren, prevProps = {}) {
  let isCE, isProp, isChildProp;

  for (const prop in props) {
    if (prop === "children") {
      if (!skipChildren) insertExpression(node, props.children);
      continue;
    }

    const value = props[prop];
    if (value === prevProps[prop]) continue;

    if (prop === "style") {
      style(node, value, prevProps[prop]);
    } else if (prop === "class" && !isSVG) {
      node.className = value;
    } else if (prop === "classList") {
      classList(node, value, prevProps[prop]);
    } else if (prop === "ref") {
      value(node);
    } else if (prop.slice(0, 3) === "on:") {
      node.addEventListener(prop.slice(3), value);
    } else if (prop.slice(0, 10) === "oncapture:") {
      node.addEventListener(prop.slice(10), value, true);
    } else if (prop.slice(0, 2) === "on") {
      const name = prop.slice(2).toLowerCase();
      const delegate = DelegatedEvents.has(name);
      addEventListener(node, name, value, delegate);
      delegate && delegateEvents([name]);
    } else if ((isChildProp = ChildProperties.has(prop)) || !isSVG && (isProp = Properties.has(prop)) || (isCE = node.nodeName.includes("-"))) {
      if (isCE && !isProp && !isChildProp) node[toPropertyName(prop)] = value;else node[prop] = value;
    } else {
      const ns = isSVG && prop.indexOf(":") > -1 && SVGNamespace[prop.split(":")[0]];
      if (ns) setAttributeNS(node, ns, prop, value);else setAttribute(node, Aliases[prop] || prop, value);
    }

    prevProps[prop] = value;
  }
}

function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}

function toggleClassKey(node, key, value) {
  const classNames = key.split(/\s+/);

  for (let i = 0, nameLen = classNames.length; i < nameLen; i++) node.classList.toggle(classNames[i], value);
}

function eventHandler(e) {
  const key = `$$${e.type}`;
  let node = e.composedPath && e.composedPath()[0] || e.target;

  if (e.target !== node) {
    Object.defineProperty(e, "target", {
      configurable: true,
      value: node
    });
  }

  Object.defineProperty(e, "currentTarget", {
    configurable: true,

    get() {
      return node;
    }

  });

  while (node !== null) {
    const handler = node[key];

    if (handler) {
      const data = node[`${key}Data`];
      data !== undefined ? handler(data, e) : handler(e);
      if (e.cancelBubble) return;
    }

    node = node.host && node.host !== node && node.host instanceof Node ? node.host : node.parentNode;
  }
}

function spreadExpression(node, props, prevProps = {}, isSVG, skipChildren) {
  if (!skipChildren && "children" in props) {
    createRenderEffect(() => prevProps.children = insertExpression(node, props.children, prevProps.children));
  }

  createRenderEffect(() => assign(node, props, isSVG, true, prevProps));
  return prevProps;
}

function insertExpression(parent, value, current, marker, unwrapArray) {
  while (typeof current === "function") current = current();

  if (value === current) return current;
  const t = typeof value,
        multi = marker !== undefined;
  parent = multi && current[0] && current[0].parentNode || parent;

  if (t === "string" || t === "number") {
    if (t === "number") value = value.toString();

    if (multi) {
      let node = current[0];

      if (node && node.nodeType === 3) {
        node.data = value;
      } else node = document.createTextNode(value);

      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    createRenderEffect(() => {
      let v = value();

      while (typeof v === "function") v = v();

      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];

    if (normalizeIncomingArray(array, value, unwrapArray)) {
      createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
      return () => current;
    }

    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else {
      if (Array.isArray(current)) {
        if (current.length === 0) {
          appendNodes(parent, array, marker);
        } else reconcileArrays(parent, current, array);
      } else if (current == null || current === "") {
        appendNodes(parent, array);
      } else {
        reconcileArrays(parent, multi && current || [parent.firstChild], array);
      }
    }

    current = array;
  } else if (value instanceof Node) {
    if (Array.isArray(current)) {
      if (multi) return current = cleanChildren(parent, current, marker, value);
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);

    current = value;
  } else ;

  return current;
}

function normalizeIncomingArray(normalized, array, unwrap) {
  let dynamic = false;

  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i],
        t;

    if (item instanceof Node) {
      normalized.push(item);
    } else if (item == null || item === true || item === false) ;else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item) || dynamic;
    } else if ((t = typeof item) === "string") {
      normalized.push(document.createTextNode(item));
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item();

        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else normalized.push(document.createTextNode(item.toString()));
  }

  return dynamic;
}

function appendNodes(parent, array, marker) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}

function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return parent.textContent = "";
  const node = replacement || document.createTextNode("");

  if (current.length) {
    let inserted = false;

    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];

      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i) isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);else isParent && parent.removeChild(el);
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);

  return [node];
}

const $RAW = Symbol("store-raw"),
      $NODE = Symbol("store-node"),
      $NAME = Symbol("store-name");

function wrap$1(value, name) {
  let p = value[$PROXY];

  if (!p) {
    Object.defineProperty(value, $PROXY, {
      value: p = new Proxy(value, proxyTraps$1)
    });
    const keys = Object.keys(value),
          desc = Object.getOwnPropertyDescriptors(value);

    for (let i = 0, l = keys.length; i < l; i++) {
      const prop = keys[i];

      if (desc[prop].get) {
        const get = desc[prop].get.bind(p);
        Object.defineProperty(value, prop, {
          get
        });
      }
    }
  }

  return p;
}

function isWrappable(obj) {
  return obj != null && typeof obj === "object" && (!obj.__proto__ || obj.__proto__ === Object.prototype || Array.isArray(obj));
}

function unwrap(item, set = new Set()) {
  let result, unwrapped, v, prop;
  if (result = item != null && item[$RAW]) return result;
  if (!isWrappable(item) || set.has(item)) return item;

  if (Array.isArray(item)) {
    if (Object.isFrozen(item)) item = item.slice(0);else set.add(item);

    for (let i = 0, l = item.length; i < l; i++) {
      v = item[i];
      if ((unwrapped = unwrap(v, set)) !== v) item[i] = unwrapped;
    }
  } else {
    if (Object.isFrozen(item)) item = Object.assign({}, item);else set.add(item);
    const keys = Object.keys(item),
          desc = Object.getOwnPropertyDescriptors(item);

    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      if (desc[prop].get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
    }
  }

  return item;
}

function getDataNodes(target) {
  let nodes = target[$NODE];
  if (!nodes) Object.defineProperty(target, $NODE, {
    value: nodes = {}
  });
  return nodes;
}

function proxyDescriptor(target, property) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (!desc || desc.get || property === $PROXY || property === $NODE || property === $NAME) return desc;
  delete desc.value;
  delete desc.writable;

  desc.get = () => target[$PROXY][property];

  return desc;
}

function createDataNode() {
  const [s, set] = createSignal(undefined, {
    equals: false
  });
  s.$ = set;
  return s;
}

const proxyTraps$1 = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    const value = target[property];
    if (property === $NODE || property === "__proto__") return value;
    const wrappable = isWrappable(value);

    if (getListener() && (typeof value !== "function" || target.hasOwnProperty(property))) {
      let nodes, node;

      if (wrappable && (nodes = getDataNodes(value))) {
        node = nodes._ || (nodes._ = createDataNode());
        node();
      }

      nodes = getDataNodes(target);
      node = nodes[property] || (nodes[property] = createDataNode());
      node();
    }

    return wrappable ? wrap$1(value) : value;
  },

  set() {
    return true;
  },

  deleteProperty() {
    return true;
  },

  getOwnPropertyDescriptor: proxyDescriptor
};

function setProperty(state, property, value) {
  if (state[property] === value) return;
  const array = Array.isArray(state);
  const len = state.length;
  const isUndefined = value === undefined;
  const notify = array || isUndefined === property in state;

  if (isUndefined) {
    delete state[property];
  } else state[property] = value;

  let nodes = getDataNodes(state),
      node;
  (node = nodes[property]) && node.$();
  if (array && state.length !== len) (node = nodes.length) && node.$(node, undefined);
  notify && (node = nodes._) && node.$(node, undefined);
}

function mergeStoreNode(state, value) {
  const keys = Object.keys(value);

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key]);
  }
}

function updatePath(current, path, traversed = []) {
  let part,
      prev = current;

  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
          isArray = Array.isArray(current);

    if (Array.isArray(part)) {
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), [part[i]].concat(traversed));
      }

      return;
    } else if (isArray && partType === "function") {
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i)) updatePath(current, [i].concat(path), [i].concat(traversed));
      }

      return;
    } else if (isArray && partType === "object") {
      const {
        from = 0,
        to = current.length - 1,
        by = 1
      } = part;

      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), [i].concat(traversed));
      }

      return;
    } else if (path.length > 1) {
      updatePath(current[part], path, [part].concat(traversed));
      return;
    }

    prev = current[part];
    traversed = [part].concat(traversed);
  }

  let value = path[0];

  if (typeof value === "function") {
    value = value(prev, traversed);
    if (value === prev) return;
  }

  if (part === undefined && value == undefined) return;
  value = unwrap(value);

  if (part === undefined || isWrappable(prev) && isWrappable(value) && !Array.isArray(value)) {
    mergeStoreNode(prev, value);
  } else setProperty(current, part, value);
}

function createStore(store, options) {
  const unwrappedStore = unwrap(store || {});
  const wrappedStore = wrap$1(unwrappedStore);

  function setStore(...args) {
    batch(() => updatePath(unwrappedStore, args));
  }

  return [wrappedStore, setStore];
} // We want to ensure the characters "%" and "/" remain in percent-encoded
// form when normalizing paths, so replace them with their encoded form after
// decoding the rest of the path


const SEGMENT_RESERVED_CHARS = /%|\//g;

function normalizeSegment(segment) {
  if (segment.length < 3 || !segment.includes("%")) return segment;
  return decodeURIComponent(segment).replace(SEGMENT_RESERVED_CHARS, encodeURIComponent);
} // We do not want to encode these characters when generating dynamic path segments
// See https://tools.ietf.org/html/rfc3986#section-3.3
// sub-delims: "!", "$", "&", "'", "(", ")", "*", "+", ",", ";", "="
// others allowed by RFC 3986: ":", "@"
//
// First encode the entire path segment, then decode any of the encoded special chars.
//
// The chars "!", "'", "(", ")", "*" do not get changed by `encodeURIComponent`,
// so the possible encoded chars are:
// ['%24', '%26', '%2B', '%2C', '%3B', '%3D', '%3A', '%40'].


const PATH_SEGMENT_ENCODINGS = /%(?:2[46BC]|3[ABD]|40)/g;

function encodePathSegment(str) {
  return encodeURIComponent(str).replace(PATH_SEGMENT_ENCODINGS, decodeURIComponent);
}

var CHARS;

(function (CHARS) {
  CHARS[CHARS["ANY"] = -1] = "ANY";
  CHARS[CHARS["STAR"] = 42] = "STAR";
  CHARS[CHARS["SLASH"] = 47] = "SLASH";
  CHARS[CHARS["COLON"] = 58] = "COLON";
})(CHARS || (CHARS = {}));

const escapeRegex = /([()*+./?[\\]{|}])/g;
const isArray = Array.isArray; // eslint-disable-next-line @typescript-eslint/unbound-method

const hasOwnProperty = Object.prototype.hasOwnProperty;

function getParam(params, key) {
  if (typeof params !== "object" || params === null) {
    throw new Error("You must pass an object as the second argument to `generate`.");
  }

  if (!hasOwnProperty.call(params, key)) {
    throw new Error(`You must provide param \`${key}\` to \`generate\`.`);
  }

  const value = params[key];
  const str = typeof value === "string" ? value : `${value}`;

  if (str.length === 0) {
    throw new Error(`You must provide a param \`${key}\`.`);
  }

  return str;
}

var SegmentType;

(function (SegmentType) {
  SegmentType[SegmentType["Static"] = 0] = "Static";
  SegmentType[SegmentType["Dynamic"] = 1] = "Dynamic";
  SegmentType[SegmentType["Star"] = 2] = "Star";
  SegmentType[SegmentType["Epsilon"] = 4] = "Epsilon";
})(SegmentType || (SegmentType = {}));

var SegmentFlags;

(function (SegmentFlags) {
  SegmentFlags[SegmentFlags["Static"] = SegmentType.Static] = "Static";
  SegmentFlags[SegmentFlags["Dynamic"] = SegmentType.Dynamic] = "Dynamic";
  SegmentFlags[SegmentFlags["Star"] = SegmentType.Star] = "Star";
  SegmentFlags[SegmentFlags["Epsilon"] = SegmentType.Epsilon] = "Epsilon";
  SegmentFlags[SegmentFlags["Named"] = SegmentType.Dynamic | SegmentType.Star] = "Named";
  SegmentFlags[SegmentFlags["Decoded"] = SegmentType.Dynamic] = "Decoded";
  SegmentFlags[SegmentFlags["Counted"] = SegmentType.Static | SegmentType.Dynamic | SegmentType.Star] = "Counted";
})(SegmentFlags || (SegmentFlags = {}));

const eachChar = [];

eachChar[SegmentType.Static] = function (segment, currentState) {
  let state = currentState;
  const value = segment.value;

  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    state = state.put(ch, false, false);
  }

  return state;
};

eachChar[SegmentType.Dynamic] = function (_, currentState) {
  return currentState.put(CHARS.SLASH, true, true);
};

eachChar[SegmentType.Star] = function (_, currentState) {
  return currentState.put(CHARS.ANY, false, true);
};

eachChar[SegmentType.Epsilon] = function (_, currentState) {
  return currentState;
};

const regex = [];

regex[SegmentType.Static] = function (segment) {
  return segment.value.replace(escapeRegex, "\\$1");
};

regex[SegmentType.Dynamic] = function () {
  return "([^/]+)";
};

regex[SegmentType.Star] = function () {
  return "(.+)";
};

regex[SegmentType.Epsilon] = function () {
  return "";
};

const generate = [];

generate[SegmentType.Static] = function (segment) {
  return segment.value;
};

generate[SegmentType.Dynamic] = function (segment, params, shouldEncode) {
  const value = getParam(params, segment.value);

  if (shouldEncode) {
    return encodePathSegment(value);
  } else {
    return value;
  }
};

generate[SegmentType.Star] = function (segment, params) {
  return getParam(params, segment.value);
};

generate[SegmentType.Epsilon] = function () {
  return "";
}; // A Segment represents a segment in the original route description.
// Each Segment type provides an `eachChar` and `regex` method.
//
// The `eachChar` method invokes the callback with one or more character
// specifications. A character specification consumes one or more input
// characters.
//
// The `regex` method returns a regex fragment for the segment. If the
// segment is a dynamic of star segment, the regex fragment also includes
// a capture.
//
// A character specification contains:
//
// * `validChars`: a String with a list of all valid characters, or
// * `invalidChars`: a String with a list of all invalid characters
// * `repeat`: true if the character specification can repeat


const EmptyObject = Object.freeze({});
const EmptyArray = Object.freeze([]); // The `names` will be populated with the paramter name for each dynamic/star
// segment. `shouldDecodes` will be populated with a boolean for each dyanamic/star
// segment, indicating whether it should be decoded during recognition.

function parse(segments, route, types) {
  // normalize route as not starting with a "/". Recognition will
  // also normalize.
  if (route.length > 0 && route.charCodeAt(0) === CHARS.SLASH) {
    route = route.substr(1);
  }

  const parts = route.split("/");
  let names = undefined;
  let shouldDecodes = undefined;

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    let type = 0;

    if (part === "") {
      type = SegmentType.Epsilon;
    } else if (part.charCodeAt(0) === CHARS.COLON) {
      type = SegmentType.Dynamic;
    } else if (part.charCodeAt(0) === CHARS.STAR) {
      type = SegmentType.Star;
    } else {
      type = SegmentType.Static;
    }

    if (type & SegmentFlags.Named) {
      part = part.slice(1);
      names = names || [];
      names.push(part);
      shouldDecodes = shouldDecodes || [];
      shouldDecodes.push((type & SegmentFlags.Decoded) !== 0);
    }

    if (type & SegmentFlags.Counted) {
      types[type]++;
    }

    segments.push({
      type,
      value: normalizeSegment(part)
    });
  }

  return {
    names: names || EmptyArray,
    shouldDecodes: shouldDecodes || EmptyArray
  };
}

function isEqualCharSpec(spec, char, negate) {
  return spec.char === char && spec.negate === negate;
} // A State has a character specification and (`charSpec`) and a list of possible
// subsequent states (`nextStates`).
//
// If a State is an accepting state, it will also have several additional
// properties:
//
// * `regex`: A regular expression that is used to extract parameters from paths
//   that reached this accepting state.
// * `handlers`: Information on how to convert the list of captures into calls
//   to registered handlers with the specified parameters
// * `types`: How many static, dynamic or star segments in this route. Used to
//   decide which route to use if multiple registered routes match a path.
//
// Currently, State is implemented naively by looping over `nextStates` and
// comparing a character specification against a character. A more efficient
// implementation would use a hash of keys pointing at one or more next states.


class State {
  constructor(states, id, char, negate, repeat) {
    this.states = states;
    this.id = id;
    this.char = char;
    this.negate = negate;
    this.nextStates = repeat ? id : null;
    this.pattern = "";
    this._regex = undefined;
    this.handlers = undefined;
    this.types = undefined;
  }

  regex() {
    if (!this._regex) {
      this._regex = new RegExp(this.pattern);
    }

    return this._regex;
  }

  get(char, negate) {
    const nextStates = this.nextStates;
    if (nextStates === null) return;

    if (isArray(nextStates)) {
      for (let i = 0; i < nextStates.length; i++) {
        const child = this.states[nextStates[i]];

        if (isEqualCharSpec(child, char, negate)) {
          return child;
        }
      }
    } else {
      const child = this.states[nextStates];

      if (isEqualCharSpec(child, char, negate)) {
        return child;
      }
    }
  }

  put(char, negate, repeat) {
    let state; // If the character specification already exists in a child of the current
    // state, just return that state.

    if (state = this.get(char, negate)) {
      return state;
    } // Make a new state for the character spec


    const states = this.states;
    state = new State(states, states.length, char, negate, repeat);
    states[states.length] = state; // Insert the new state as a child of the current state

    if (this.nextStates == null) {
      this.nextStates = state.id;
    } else if (isArray(this.nextStates)) {
      this.nextStates.push(state.id);
    } else {
      this.nextStates = [this.nextStates, state.id];
    } // Return the new state


    return state;
  } // Find a list of child states matching the next character


  match(ch) {
    const nextStates = this.nextStates;
    if (!nextStates) return [];
    const returned = [];

    if (isArray(nextStates)) {
      for (let i = 0; i < nextStates.length; i++) {
        const child = this.states[nextStates[i]];

        if (isMatch(child, ch)) {
          returned.push(child);
        }
      }
    } else {
      const child = this.states[nextStates];

      if (isMatch(child, ch)) {
        returned.push(child);
      }
    }

    return returned;
  }

}

function isMatch(spec, char) {
  return spec.negate ? spec.char !== char && spec.char !== CHARS.ANY : spec.char === char || spec.char === CHARS.ANY;
} // This is a somewhat naive strategy, but should work in a lot of cases
// A better strategy would properly resolve /posts/:id/new and /posts/edit/:id.
//
// This strategy generally prefers more static and less dynamic matching.
// Specifically, it
//
//  * prefers fewer stars to more, then
//  * prefers using stars for less of the match to more, then
//  * prefers fewer dynamic segments to more, then
//  * prefers more static segments to more


function sortSolutions(states) {
  return states.sort(function (a, b) {
    const [astatics, adynamics, astars] = a.types || [0, 0, 0];
    const [bstatics, bdynamics, bstars] = b.types || [0, 0, 0];

    if (astars !== bstars) {
      return astars - bstars;
    }

    if (astars) {
      if (astatics !== bstatics) {
        return bstatics - astatics;
      }

      if (adynamics !== bdynamics) {
        return bdynamics - adynamics;
      }
    }

    if (adynamics !== bdynamics) {
      return adynamics - bdynamics;
    }

    if (astatics !== bstatics) {
      return bstatics - astatics;
    }

    return 0;
  });
}

function recognizeChar(states, ch) {
  let nextStates = [];

  for (let i = 0, l = states.length; i < l; i++) {
    const state = states[i];
    nextStates = nextStates.concat(state.match(ch));
  }

  return nextStates;
}

function createResults(queryParams) {
  const results = [];
  results.queryParams = queryParams || {};
  return results;
}

function findHandler(state, originalPath, queryParams) {
  const handlers = state.handlers;
  const regex = state.regex();
  if (!regex || !handlers) throw new Error("state not initialized");
  const captures = regex.exec(originalPath);
  let currentCapture = 1;
  const result = createResults(queryParams);
  result.length = handlers.length;

  for (let i = 0; i < handlers.length; i++) {
    const handler = handlers[i];
    const names = handler.names;
    const shouldDecodes = handler.shouldDecodes;
    let params = EmptyObject;
    let isDynamic = false;

    if (names !== EmptyArray && shouldDecodes !== EmptyArray) {
      for (let j = 0; j < names.length; j++) {
        isDynamic = true;
        const name = names[j];
        const capture = captures && captures[currentCapture++];

        if (params === EmptyObject) {
          params = {};
        }

        params[name] = capture;
      }
    }

    result[i] = {
      handler: handler.handler,
      path: handler.path,
      params,
      isDynamic
    };
  }

  return result;
}

function decodeQueryParamPart(part) {
  // http://www.w3.org/TR/html401/interact/forms.html#h-17.13.4.1
  part = part.replace(/\+/gm, "%20");
  let result;

  try {
    result = decodeURIComponent(part);
  } catch (error) {
    result = "";
  }

  return result;
}

class RouteRecognizer {
  constructor() {
    const states = [];
    const state = new State(states, 0, CHARS.ANY, true, false);
    states[0] = state;
    this.rootState = state;
  }

  add(routes) {
    let currentState = this.rootState;
    let pattern = "^";
    const types = [0, 0, 0];
    const handlers = new Array(routes.length);
    const allSegments = [];
    let isEmpty = true;
    let j = 0;

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const {
        names,
        shouldDecodes
      } = parse(allSegments, route.path, types); // preserve j so it points to the start of newly added segments

      for (; j < allSegments.length; j++) {
        const segment = allSegments[j];

        if (segment.type === SegmentType.Epsilon) {
          continue;
        }

        isEmpty = false; // Add a "/" for the new segment

        currentState = currentState.put(CHARS.SLASH, false, false);
        pattern += "/"; // Add a representation of the segment to the NFA and regex

        currentState = eachChar[segment.type](segment, currentState);
        pattern += regex[segment.type](segment);
      }

      handlers[i] = {
        handler: route.handler,
        path: route.alias || route.path,
        names,
        shouldDecodes
      };
    }

    if (isEmpty) {
      currentState = currentState.put(CHARS.SLASH, false, false);
      pattern += "/";
    }

    currentState.handlers = handlers;
    currentState.pattern = `${pattern}$`;
    currentState.types = types;
  }

  recognize(path) {
    let results;
    let states = [this.rootState];
    let queryParams = {};
    let isSlashDropped = false;
    const hashStart = path.indexOf("#");

    if (hashStart !== -1) {
      path = path.substr(0, hashStart);
    }

    const queryStart = path.indexOf("?");

    if (queryStart !== -1) {
      const queryString = path.substr(queryStart + 1, path.length);
      path = path.substr(0, queryStart);
      queryParams = parseQueryString(queryString);
    }

    if (!path.startsWith("/")) {
      path = `/${path}`;
    }

    let originalPath = path;
    path = decodeURI(path);
    originalPath = decodeURI(originalPath);
    const pathLen = path.length;

    if (pathLen > 1 && path.charAt(pathLen - 1) === "/") {
      path = path.substr(0, pathLen - 1);
      originalPath = originalPath.substr(0, originalPath.length - 1);
      isSlashDropped = true;
    }

    for (let i = 0; i < path.length; i++) {
      states = recognizeChar(states, path.charCodeAt(i));

      if (!states.length) {
        break;
      }
    }

    const solutions = [];

    for (let i = 0; i < states.length; i++) {
      if (states[i].handlers) {
        solutions.push(states[i]);
      }
    }

    states = sortSolutions(solutions);
    const state = solutions[0];

    if (state && state.handlers) {
      // if a trailing slash was dropped and a star segment is the last segment
      // specified, put the trailing slash back
      if (isSlashDropped && state.char === CHARS.ANY) {
        originalPath = `${originalPath}/`;
      }

      results = findHandler(state, originalPath, queryParams);
    }

    return results;
  }

}

function parseQueryString(queryString) {
  const pairs = queryString.split("&");
  const queryParams = {};

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].split("=");
    let key = decodeQueryParamPart(pair[0]);
    const keyLength = key.length;
    let isArray = false;
    let value;

    if (pair.length === 1) {
      value = "true";
    } else {
      // Handle arrays
      if (keyLength > 2 && key.endsWith("[]")) {
        isArray = true;
        key = key.slice(0, keyLength - 2);

        if (!queryParams[key]) {
          queryParams[key] = [];
        }
      }

      value = pair[1] ? decodeQueryParamPart(pair[1]) : "";
    }

    if (isArray) {
      queryParams[key].push(value);
    } else {
      queryParams[key] = value;
    }
  }

  return queryParams;
}

const _tmpl$$1 = template(`<a></a>`);

const RouterContext = createContext();

function useRouter() {
  return useContext(RouterContext);
}

function Route(props) {
  const [router, actions] = useRouter(),
        childRouter = mergeProps(router, {
    level: router.level + 1
  }),
        component = createMemo(() => {
    const resolved = router.current;
    return resolved[router.level] && resolved[router.level].handler.component;
  });
  return createComponent(RouterContext.Provider, {
    value: [childRouter, actions],

    get children() {
      return createComponent(Show, {
        get when() {
          return component();
        },

        children: C => {
          return createComponent(C, mergeProps({
            get params() {
              return router.params;
            },

            get query() {
              return router.query;
            }

          }, router.data[router.level], props, {
            get children() {
              return createComponent(Route, {});
            }

          }));
        }
      });
    }

  });
}

const Link = props => {
  const [router, {
    push
  }] = useRouter();
  return (() => {
    const _el$ = _tmpl$$1.cloneNode(true);

    _el$.$$click = e => {
      if (props.external || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button || e.defaultPrevented) return;
      e.preventDefault();
      push(props.href || "");
    };

    spread(_el$, props, false, true);
    insert(_el$, () => props.children);
    createRenderEffect(() => setAttribute(_el$, "href", router.root + props.href));
    return _el$;
  })();
};

const Router = props => {
  const router = createRouter(props.routes, props.initialURL, props.root);
  props.out && (props.out.router = router);
  return createComponent(RouterContext.Provider, {
    value: router,

    get children() {
      return props.children;
    }

  });
};

function shallowDiff(prev, next, set, key) {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  for (let i = 0; i < prevKeys.length; i++) {
    const k = prevKeys[i];
    if (next[k] == null) set(key, k, undefined);
  }

  for (let i = 0; i < nextKeys.length; i++) {
    const k = nextKeys[i];
    if (next[k] !== prev[k]) set(key, k, next[k]);
  }

  return { ...next
  };
}

function createRouter(routes, initialURL, root = "") {
  const recognizer = new RouteRecognizer();
  processRoutes(recognizer, routes, root);
  const [location, setLocation] = createSignal(initialURL ? initialURL : window.location.pathname.replace(root, "") + window.location.search);
  const current = createMemo(() => recognizer.recognize(root + location()) || []);
  const data = [];
  const [pending, start] = useTransition();
  const [routeState, setRouteState] = createStore({
    params: {},
    query: {}
  });
  const state = {
    root,

    get location() {
      return location();
    },

    get pending() {
      return pending();
    },

    get params() {
      return routeState.params;
    },

    get query() {
      return routeState.query;
    },

    level: 0
  }; // make it non-enumerable

  Object.defineProperties(state, {
    current: {
      get() {
        return current();
      }

    },
    data: {
      value: data
    }
  });
  const actions = {
    push(path) {
      window.history.pushState("", "", root + path);
      start(() => setLocation(path), () => window.scrollTo(0, 0));
    },

    replace(path) {
      window.history.replaceState("", "", root + path);
      start(() => setLocation(path), () => window.scrollTo(0, 0));
    },

    back() {
      window.history.back();
      start(() => setLocation(window.location.pathname.replace(root, "") + window.location.search));
    },

    addRoutes(routes) {
      processRoutes(recognizer, routes, root);
    },

    isActive(url, exact = false) {
      let ref;
      return state.location.startsWith(url) && (!exact || (ref = state.location[url.length]) === undefined || ref === "?");
    }

  };
  createComputed(prev => {
    const newQuery = current().queryParams || {};
    const newParams = current().reduce((memo, item) => Object.assign(memo, item.params), {});
    return batch(() => ({
      query: shallowDiff(prev.query, newQuery, setRouteState, "query"),
      params: shallowDiff(prev.params, newParams, setRouteState, "params")
    }));
  }, {
    query: {},
    params: {}
  });
  const disposers = [];
  onCleanup(() => {
    for (let i = 0, len = disposers.length; i < len; i++) disposers[i]();
  });
  createComputed(prevLevels => {
    const levels = current();
    let i = 0;

    function mapFn(dispose) {
      disposers[i] = dispose;
      return levels[i].handler.data(state, actions);
    }

    while (prevLevels[i] && levels[i] && prevLevels[i].handler.component === levels[i].handler.component && prevLevels[i].handler.data === levels[i].handler.data) i++;

    for (let j = i; j < prevLevels.length; j++) {
      disposers[j] && disposers[j]();
    }

    for (; i < levels.length; i++) {
      if (levels[i].handler.component.preload) levels[i].handler.component.preload();

      if (levels[i].handler.data) {
        data[i] = createRoot(mapFn);
      } else data[i] = {};
    }

    return [...levels];
  }, []);
  (window.onpopstate = () => start(() => setLocation(window.location.pathname.replace(root, "") + window.location.search)));
  return [state, actions];
}

function processRoutes(router, routes, root, parentRoutes = []) {
  let noIndex = !routes.find(r => r.path === "/");
  routes.forEach(r => {
    const mapped = {
      path: root + r.path,
      handler: {
        component: r.component,
        data: r.data
      }
    };

    if (!r.children) {
      if (noIndex && (r.path[0] === "*" || r.path[1] === "*")) {
        router.add([...parentRoutes, { ...mapped,
          path: `${root}/`,
          alias: mapped.path
        }]);
        noIndex = false;
      }

      router.add([...parentRoutes, mapped]);
      return;
    }

    processRoutes(router, r.children, "", [...parentRoutes, mapped]);
  });
}

delegateEvents(["click"]);

const _tmpl$ = template(`<strong>HN</strong>`),
      _tmpl$2 = template(`<strong>New</strong>`),
      _tmpl$3 = template(`<strong>Show</strong>`),
      _tmpl$4 = template(`<strong>Ask</strong>`),
      _tmpl$5 = template(`<strong>Jobs</strong>`),
      _tmpl$6 = template(`<header class="header"><nav class="inner"><a class="github" href="http://github.com/solidjs/solid" target="_blank" rel="noreferrer">Built with Solid</a></nav></header>`);
function Nav() {
  return (() => {
    const _el$ = _tmpl$6.cloneNode(true),
          _el$2 = _el$.firstChild,
          _el$8 = _el$2.firstChild;

    insert(_el$2, createComponent(Link, {
      href: "/",

      get children() {
        return _tmpl$.cloneNode(true);
      }

    }), _el$8);

    insert(_el$2, createComponent(Link, {
      href: "/new",

      get children() {
        return _tmpl$2.cloneNode(true);
      }

    }), _el$8);

    insert(_el$2, createComponent(Link, {
      href: "/show",

      get children() {
        return _tmpl$3.cloneNode(true);
      }

    }), _el$8);

    insert(_el$2, createComponent(Link, {
      href: "/ask",

      get children() {
        return _tmpl$4.cloneNode(true);
      }

    }), _el$8);

    insert(_el$2, createComponent(Link, {
      href: "/job",

      get children() {
        return _tmpl$5.cloneNode(true);
      }

    }), _el$8);

    return _el$;
  })();
}

const mapStories = {
  top: "news",
  new: "newest",
  show: "show",
  ask: "ask",
  job: "jobs"
};
const cache = {};

const get = path => cache[path] || (cache[path] = fetch(path.startsWith("user") ? `https://hacker-news.firebaseio.com/v0/${path}.json` : `https://node-hnapi.herokuapp.com/${path}`).then(r => r.json()));

function useStory(id) {
  return createResource(() => `item/${id()}`, get)[0];
}
function useUser(id) {
  return createResource(() => `user/${id()}`, get)[0];
}
function useStories(type, page) {
  return createResource(() => `${mapStories[type()]}?page=${page()}`, get)[0];
}

function StoriesData(props) {
  const page = () => +(props.query.page || 1),
        type = () => props.params.stories || "top",
        stories = useStories(type, page);

  return {
    get type() {
      return type();
    },

    get stories() {
      return stories();
    },

    get page() {
      return page();
    }

  };
}

function StoryData(props) {
  const story = useStory(() => props.params.id);
  return {
    get story() {
      return story();
    }

  };
}

function UserData(props) {
  const user = useUser(() => props.params.id);
  return {
    get user() {
      return user();
    }

  };
}

var routes = [{
  path: "/users/:id",
  component: lazy(() => import('./[id]-6d0f15eb.js')),
  data: UserData
}, {
  path: "/stories/:id",
  component: lazy(() => import('./[id]-5fc506d4.js')),
  data: StoryData
}, {
  path: "/*stories",
  component: lazy(() => import('./[...stories]-2119c25a.js')),
  data: StoriesData
}];

render(() => createComponent(Router, {
  routes: routes,

  get root() {
    return "";
  },

  get children() {
    return [createComponent(Nav, {}), createComponent(Route, {
      "class": "view"
    })];
  }

}), document.body);

if ("serviceWorker" in navigator) {
  // Use the window load event to keep the page load performant
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${""}sw.js`);
  });
}

export { For as F, Link as L, Show as S, createRenderEffect as a, createSignal as b, createComponent as c, delegateEvents as d, insert as i, memo as m, setAttribute as s, template as t };
