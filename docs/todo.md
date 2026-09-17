# Active Follow-Up Work

- [x] Remove obsolete `features/triggering.py` and verify lifecycle discovery
	imports only active feature modules.
- [x] Replace `NotificationSchedule` indirection with direct listener-owned
	timing while preserving monitor checks and confirmation reminders.
- [ ] Add regression tests proving generic Notify preserves confirmation clear
	behavior, completion delivery, and retries.
- [ ] Audit feature constructors and workflow methods for unused arguments,
	trivial forwarding methods, and stale compatibility paths.
- [ ] Review `support/storage.py` and shared helpers for safe inlining or
	removal after the architecture cleanup.
- [ ] Add focused `AlertFlow` tests covering condition delivery ordering,
	  delivery failure handling, confirmation completion, and persistence.
- [x] Add frontend component regression coverage for confirmation toggles,
	  test-alert delivery, YAML condition errors, and popup dismissal.
- [x] Run frontend build and frontend tests when frontend modules change.
