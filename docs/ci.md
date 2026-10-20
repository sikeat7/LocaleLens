# GitHub Actions integration

The repository's own workflow checks types, formatting, browser tests, and package contents on Linux, macOS, and Windows. These jobs run after the project is pushed to GitHub; creating the workflow does not establish that the matrix has passed.

For an application that includes LocaleLens as a development dependency after publication, adapt this example. The application start/readiness commands must match your framework.

```yaml
name: Localization layout
on: [pull_request]
permissions:
  contents: read
jobs:
  layout:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - name: Start app and wait for readiness
        shell: bash
        run: |
          npm run start -- --port 3000 > app.log 2>&1 &
          node --input-type=module <<'JS'
          const deadline = Date.now() + 60000;
          while (true) {
            try {
              const response = await fetch('http://127.0.0.1:3000', { signal: AbortSignal.timeout(2000) });
              if (response.ok) break;
            } catch {}
            if (Date.now() > deadline) throw new Error('Application did not become ready');
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          JS
      - run: npx --no-install localelens scan http://127.0.0.1:3000 --fail-on warning
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7
        if: always()
        with:
          name: localization-layout-report
          path: localelens-report/
          retention-days: 7
          if-no-files-found: warn
```

Pin the LocaleLens package version in your lockfile. The example assumes the package has already been released and added to your application's development dependencies; the initial source checkout uses `node dist/cli.js` instead.

Reports contain page content and screenshots. Use test data, configure masks, and choose an artifact retention/access policy appropriate to the application. Do not put production credentials into fork pull-request workflows.
