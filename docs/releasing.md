# Release guide

The project is built for source use and npm packaging. Publishing requires the repository owner's GitHub/npm identity and an explicit release decision. No public repository, package, or release is created by local build commands.

## First publication

1. Create the intended GitHub repository and set it as `origin`.
2. Add the real `repository`, `bugs`, and `homepage` metadata to `package.json`. Choose the final npm name or scope and confirm that the publishing account can use it. Name availability is not reserved by this repository.
3. Enable private vulnerability reporting, branch protection, and the CI checks appropriate to your project.
4. Run the configured GitHub Actions matrix and resolve failures. A local build passing on one OS does not verify all platforms.
5. Run `npm ci`, install the matched Chromium build, and run `npm run check` in an environment that allows headless browser processes.
6. Run `npm audit --omit=dev` and review any advisories. Run `npm pack --dry-run` and inspect the package file list.
7. Create a tarball with `npm pack`. Install it into a clean temporary project and verify the `localelens` binary and a real scan before release.
8. Set the release version and changelog. Commit the release, publish the reviewed package through your npm account, and create the matching GitHub tag/release.

## Publish only after review

These commands have external effects and are intentionally separate from build/test:

```sh
npm login
npm publish --access public
```

After publication, add the verified package installation command to the README. Configure npm trusted publishing if you later automate releases; never commit registry tokens. Release instructions should match your account's current authentication and publishing policies.

## Launch material

- Use the demo site's broken/flexible versions for a short screen recording.
- Show one reproduced clipping or RTL bug and the generated report.
- Explain that text expansion is a simulation and state the detection boundaries.
- Add relevant GitHub topics: `i18n`, `localization`, `rtl`, `playwright`, `developer-tools`.
- Invite small fixture-based bug reports and first contributions.

Measure repeat use and actionable findings. Stars are an interest signal, not evidence that the checks are correct.
