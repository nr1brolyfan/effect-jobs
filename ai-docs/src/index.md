# effect-auth implementation patterns

The `.ts` files are canonical, typechecked patterns. Load only what the task needs.

```text
Always:          01_services, 02_modeling, 03_errors, 08_style
Auth operation:  + 04_observability, 05_resources, 09_testing
Persistence:     + 05_resources, 06_persistence, 09_testing
Transport:       + 02_modeling, 03_errors, 07_transport, 09_testing
External API:    + 10_boundaries
```

Production code is the final authority when a snippet and the pinned Effect API diverge.
