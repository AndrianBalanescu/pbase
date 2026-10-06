# Third-party licenses

baseStarter's own code is MIT — see the [`LICENSE`](../../../../LICENSE) file at the repository root
(that stays in the root on purpose: GitHub and most tooling only auto-detect a project license when it
sits at the top level).

Everything baseStarter **bundles or vendors** is MIT too. The full texts are collected here, one file
per dependency, instead of being scattered across the repo root.

| File | Component | Version | Copyright |
|---|---|---|---|
| [`pocketbase-server.txt`](./pocketbase-server.txt) | PocketBase server (the `base/pocketbase` binary) | 0.40.4 | © 2022–present Gani Georgiev |
| [`pocketbase-js-sdk.txt`](./pocketbase-js-sdk.txt) | PocketBase JS SDK (`vendor/pocketbase.umd.js`) | 0.26.8 | © 2022–present Gani Georgiev |
| [`vue.txt`](./vue.txt) | Vue 3 global build (`vendor/vue.global.prod.js`) | 3.5.13 | © 2018–present Yuxi (Evan) You and Vue contributors |
| [`ohno.txt`](./ohno.txt) | ohno UI kit (`vendor/ohno/`) | 4.6 | © 2026 Andrian Balanescu |
| [`scalar.txt`](./scalar.txt) | Scalar API reference (`vendor/scalar.standalone.js`) | @scalar/api-reference 1.73.0 | © 2023–present Scalar |

All five are released under the MIT License, reproduced verbatim in each file. To refresh a vendored
library, download the new pinned file into `base/pb_public/vendor/` and update its row here — and the
matching row in [`index.html`](./index.html), the human-readable page served at `/docs/licenses/`.

## Integrity fingerprints

The vendored files are minified, so most carry no human-readable version string. Each version above
was established from the project's own release metadata — byte-compared against its official npm/unpkg
release for PocketBase, Vue and Scalar, and read from the build banner (`ohno.js v4.6`) for ohno. These
SHA-256 digests let you confirm a re-download still matches what is committed here.

| File | SHA-256 |
|---|---|
| `vendor/pocketbase.umd.js` | `47db312dde7060f1887e7e6dd9470af64d3bf4c1dd1df9dec721a7c629aafacc` |
| `vendor/vue.global.prod.js` | `c459ba7cc8db65c982589fa5d64c7ff478877e8e5b0fd75683207cec6a4e89e8` |
| `vendor/ohno/ohno.min.js` | `cc2f59c28858d11debf3efb11d0694c30eddad2706e80e49cc99624c9da6c39d` |
| `vendor/scalar.standalone.js` | `26b06691fc0e2e35c631f1455371d9cd4cf17e3565d2a93d623d0017951e48ac` |

The `base/pocketbase` binary is not committed — `scripts/bootstrap.sh` downloads the version pinned in
`base/pocketbase.version` at setup time.
