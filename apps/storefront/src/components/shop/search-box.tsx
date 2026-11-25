import { useSearchSuggestions } from '@marketplace/api-client';
import { Button, cn } from '@marketplace/ui';
import { SearchIcon } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { productPath } from '../../lib/paths';

/** Keyword search with suggestions (products, categories, stores) as you type. */
export function SearchBox({ className }: { className?: string }) {
  const [params] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const [value, setValue] = useState(urlQuery);
  const [seenQuery, setSeenQuery] = useState(urlQuery);
  if (urlQuery !== seenQuery) {
    // The URL changed (new search, back button): show its query.
    setSeenQuery(urlQuery);
    setValue(urlQuery);
  }
  const [debounced, setDebounced] = useState(value);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const listId = useId();
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), 200);
    return () => window.clearTimeout(timer);
  }, [value]);
  const suggestions = useSearchSuggestions(open ? debounced : '');
  const s = suggestions.data;
  const any = !!s && s.products.length + s.categories.length + s.stores.length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setOpen(false);
    const q = value.trim();
    void navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  return (
    <form role="search" onSubmit={submit} className={cn('relative', className)}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search products, stores and categories
      </label>
      <div className="flex">
        <input
          id={`${listId}-input`}
          type="search"
          value={value}
          placeholder="Search products, stores and categories"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && any}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          className="h-10 w-full min-w-0 rounded-l-md border border-r-0 bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" className="h-10 rounded-l-none px-3" aria-label="Search">
          <SearchIcon aria-hidden="true" />
        </Button>
      </div>
      {open && any ? (
        <div
          id={listId}
          className="absolute inset-x-0 top-11 z-40 max-h-96 overflow-auto rounded-md border bg-popover p-2 text-sm shadow-lg"
        >
          {s.products.length > 0 ? (
            <ul aria-label="Products">
              {s.products.map((p) => (
                <li key={p.id}>
                  <Link
                    to={productPath(p)}
                    className="block rounded px-2 py-1.5 hover:bg-accent focus:bg-accent focus:outline-none"
                    onClick={() => setOpen(false)}
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {s.categories.length > 0 ? (
            <>
              <p className="mt-2 px-2 text-xs font-medium text-muted-foreground">Categories</p>
              <ul aria-label="Categories">
                {s.categories.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/c/${c.slug}`}
                      className="block rounded px-2 py-1.5 hover:bg-accent"
                      onClick={() => setOpen(false)}
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {s.stores.length > 0 ? (
            <>
              <p className="mt-2 px-2 text-xs font-medium text-muted-foreground">Stores</p>
              <ul aria-label="Stores">
                {s.stores.map((st) => (
                  <li key={st.id}>
                    <Link
                      to={`/s/${st.slug}`}
                      className="block rounded px-2 py-1.5 hover:bg-accent"
                      onClick={() => setOpen(false)}
                    >
                      {st.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
