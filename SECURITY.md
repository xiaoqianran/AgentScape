# Security policy

The 2.0 development build is unreleased. Security fixes target the current development branch; older versions have no promised support window.

Do not post credentials, exploit details or private project data in public issues. Use the repository Security tab to submit a private vulnerability report when available. Otherwise open a minimal issue requesting a private reporting channel, without vulnerability details. Maintainers must enable a private channel before public release.

Include the affected commit, entry point, permissions, impact and minimal reproduction through the private channel. No response-time SLA is promised.

Untrusted procedural source requires the Docker/QuickJS runner. Never substitute host execution. Default browser Agent tools accept bounded commands and recipes. Resource hashes detect corruption, not trusted authorship. Keep development servers private; never commit credentials or local sandbox configuration.

Before release review npm audit, required regressions and real container security tests. Paid-provider integrations remain separate from ordinary contributor tests.
