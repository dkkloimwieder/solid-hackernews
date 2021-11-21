import { i as insert, m as memo, c as createComponent, L as Link, a as createRenderEffect, s as setAttribute, S as Show, t as template, F as For } from './index.js';

const _tmpl$$1 = template(`<a target="_blank" rel="noreferrer"></a>`),
      _tmpl$2$1 = template(`<span class="host"> (<!>)</span>`),
      _tmpl$3$1 = template(`<span class="label"></span>`),
      _tmpl$4$1 = template(`<li class="news-item"><span class="score"></span><span class="title"></span><br><span class="meta"></span></li>`);
function Story(props) {
  return (() => {
    const _el$ = _tmpl$4$1.cloneNode(true),
          _el$2 = _el$.firstChild,
          _el$3 = _el$2.nextSibling,
          _el$9 = _el$3.nextSibling,
          _el$10 = _el$9.nextSibling;

    insert(_el$2, () => props.story.points);

    insert(_el$3, (() => {
      const _c$ = memo(() => !!props.story.url, true);

      return createComponent(Show, {
        get when() {
          return _c$() && !props.story.url.startsWith('item?id=');
        },

        get fallback() {
          return createComponent(Link, {
            get href() {
              return `/item/${props.story.id}`;
            },

            get children() {
              return props.story.title;
            }

          });
        },

        get children() {
          return [(() => {
            const _el$4 = _tmpl$$1.cloneNode(true);

            insert(_el$4, () => props.story.title);

            createRenderEffect(() => setAttribute(_el$4, "href", props.story.url));

            return _el$4;
          })(), (() => {
            const _el$5 = _tmpl$2$1.cloneNode(true),
                  _el$6 = _el$5.firstChild,
                  _el$8 = _el$6.nextSibling;
                  _el$8.nextSibling;

            insert(_el$5, () => props.story.domain, _el$8);

            return _el$5;
          })()];
        }

      });
    })());

    insert(_el$10, createComponent(Show, {
      get when() {
        return props.story.type !== "job";
      },

      get fallback() {
        return createComponent(Link, {
          get href() {
            return `/stories/${props.story.id}`;
          },

          get children() {
            return props.story.time_ago;
          }

        });
      },

      get children() {
        return ["by ", createComponent(Link, {
          get href() {
            return `/users/${props.story.user}`;
          },

          get children() {
            return props.story.user;
          }

        }), " ", memo(() => props.story.time_ago), " |", " ", createComponent(Link, {
          get href() {
            return `/stories/${props.story.id}`;
          },

          get children() {
            return props.story.comments_count ? `${props.story.comments_count} comments` : "discuss";
          }

        })];
      }

    }));

    insert(_el$, createComponent(Show, {
      get when() {
        return props.story.type !== "link";
      },

      get children() {
        return [" ", (() => {
          const _el$11 = _tmpl$3$1.cloneNode(true);

          insert(_el$11, () => props.story.type);

          return _el$11;
        })()];
      }

    }), null);

    return _el$;
  })();
}

const _tmpl$ = template(`<ul></ul>`),
      _tmpl$2 = template(`<div class="news-view"><div class="news-list-nav"><span>page </span></div><main class="news-list"></main></div>`),
      _tmpl$3 = template(`<span class="page-link disabled" aria-hidden="true">&lt; prev</span>`),
      _tmpl$4 = template(`<span class="page-link disabled" aria-hidden="true">more &gt;</span>`);
function Stories(props) {
  return (() => {
    const _el$ = _tmpl$2.cloneNode(true),
          _el$2 = _el$.firstChild,
          _el$3 = _el$2.firstChild;
          _el$3.firstChild;
          const _el$5 = _el$2.nextSibling;

    insert(_el$2, createComponent(Show, {
      get when() {
        return props.page > 1;
      },

      get fallback() {
        return _tmpl$3.cloneNode(true);
      },

      get children() {
        return createComponent(Link, {
          "class": "page-link",

          get href() {
            return `/${props.type}?page=${props.page - 1}`;
          },

          "aria-label": "Previous Page",

          get children() {
            return ["<", " prev"];
          }

        });
      }

    }), _el$3);

    insert(_el$3, () => props.page, null);

    insert(_el$2, createComponent(Show, {
      get when() {
        var _props$stories;

        return ((_props$stories = props.stories) === null || _props$stories === void 0 ? void 0 : _props$stories.length) >= 28;
      },

      get fallback() {
        return _tmpl$4.cloneNode(true);
      },

      get children() {
        return createComponent(Link, {
          "class": "page-link",

          get href() {
            return `/${props.type}?page=${props.page + 1}`;
          },

          "aria-label": "Next Page",

          get children() {
            return ["more ", ">"];
          }

        });
      }

    }), null);

    insert(_el$5, createComponent(Show, {
      get when() {
        return props.stories;
      },

      get children() {
        const _el$6 = _tmpl$.cloneNode(true);

        insert(_el$6, createComponent(For, {
          get each() {
            return props.stories;
          },

          children: story => createComponent(Story, {
            story: story
          })
        }));

        return _el$6;
      }

    }));

    return _el$;
  })();
}

export default Stories;
