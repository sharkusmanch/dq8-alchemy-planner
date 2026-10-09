# Save URL

The save URL is optional. If you can serve your newest Dragon Quest VIII save file at a web address, the planner will import it for you, so you do not have to pick a file after every church save. Hosting it is up to you; the app only reads from it.

Set it in the **More** tab, in the Save URL box.

## The contract

The address must answer a `GET` with:

- The raw save as the response body: exactly **23,776 bytes**. A memory card image, a zip or a web page will be rejected.
- For an address on another site than the app (including the public site), an `Access-Control-Allow-Origin` header that allows the site you are using, which for the public site is `https://sharkusmanch.github.io`, and HTTPS. Without the header the browser blocks the read and the app reports a network or CORS error. An address on the app's own origin, such as a relative `./save` served next to the page, needs neither a CORS header nor extra configuration: the request is an ordinary same-origin one and inherits whatever protects the page.
- A successful (2xx) status. Any other status is shown as an error. The body must then be exactly 23,776 bytes, or the app rejects it.

The file has to be the plain save (the memory-card file named like `BASLUS-21207dq8_0`), not a whole card.

## Built-in address for a self-hosted copy

A copy built with `VITE_DEFAULT_SAVE_URL=./save` (see Self-hosting in the README) uses that address whenever the Save URL box in More is empty. Anything typed in the box wins over it. In that mode:

- The notices read "Couldn't load the save from this site: ..." instead of "...from your URL: ...".
- A 404 means no save has been synced yet. Automatic checks stay silent (and remove an earlier error notice); **Refresh now** says "No save has been synced to this server yet." A 404 from an address you typed is reported as an error as usual.

## Same-origin addresses and sign-in

For an address on the page's own origin (relative, or resolving to the same scheme, host and port) the app does not follow redirects. A site that sits behind a login normally answers an expired session with a redirect to its sign-in page, which a browser cannot hand back as a save. The app then shows "Your sign-in to this site has expired. Reload the page." and imports nothing. Addresses on other sites are fetched as before, with redirects followed.

## When the app fetches

- When the app opens.
- When you switch back to the tab or app (when it becomes visible again).
- When you press **Refresh now** in More.

The switch "Check for a new save automatically" in More (shown once there is an address to check) turns the first two off for that browser; **Refresh now** still works. Automatic fetches happen at most once every 30 seconds. **Refresh now** always runs. A request that gets no answer within 10 seconds is abandoned and a notice says so.

The app imports only when the bytes differ from the last import. If nothing changed, nothing happens. If a fetch fails, you get a small notice and your progress is not touched. A successful import shows a one-line summary with Undo. If you undo a URL import, the app will not re-import the same bytes automatically for as long as the page stays open (use **Refresh now** to bring them back). That memory of the undone save is not stored: after you reload the page or reopen the app, the first fetch imports those bytes again.

## A minimal example

Serve one file with nginx:

```nginx
location = /dq8-save.bin {
    alias /path/to/BASLUS-21207dq8_0;
    add_header Access-Control-Allow-Origin "https://sharkusmanch.github.io" always;
    add_header Cache-Control "no-store" always;
}
```

Or, for testing on your own machine, a few lines of Python. This is for a page served from another site, such as the public one: whether an HTTPS page may fetch from a plain `http://` loopback address depends on the browser. Some allow it and others block it. If yours blocks it, the endpoint needs HTTPS, and so does any address that is not on your own machine. A copy of the app served over plain `http://` from the same origin as the save is not affected.

```python
from http.server import BaseHTTPRequestHandler, HTTPServer

SAVE = "/path/to/BASLUS-21207dq8_0"
ORIGIN = "https://sharkusmanch.github.io"

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = open(SAVE, "rb").read()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

HTTPServer(("127.0.0.1", 8080), Handler).serve_forever()
```

Check it from a shell: `curl -s URL | wc -c` should print `23776`.

## Security and privacy

The endpoint is yours to host and secure. Anyone who has the address can download your save, so keep it unguessable or put it behind access you control. Do not put credentials in the URL you share with others.

The URL is stored only in your browser. It is left out of exported state, so a backup file does not carry it, and importing a backup keeps whatever URL you already have. Reset clears it. The automatic-check switch is a setting of the same kind: a backup file carries it, but importing one keeps this browser's own choice.
