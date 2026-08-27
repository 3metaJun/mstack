# Deepening a module

Classify dependencies before moving responsibilities behind a new interface.

## In-process dependencies

Pure computation and in-memory state can normally move inside the module. Test
the resulting behavior through its public interface.

## Local substitutes

Use a realistic local implementation such as an in-memory filesystem or local
database when it preserves the behavior under test. Keep that seam internal
unless callers genuinely choose implementations.

## Owned remote systems

Place a port at the network seam. Keep domain behavior in the owning module and
inject the transport adapter. Tests may use an in-memory adapter when it models
the contract faithfully.

## External services

Wrap only the external contract the application uses. Inject that port and test
application behavior with a focused fake. Keep vendor payloads and error
translation inside the production adapter.

## Migration and tests

Move one coherent responsibility at a time. Add behavior tests at the new
interface, migrate callers, then remove superseded shallow modules and tests.
Do not retain old layers merely to avoid deleting obsolete tests.

Tests should assert observable behavior and survive internal refactoring. If a
test must reach through the interface, reconsider the module shape before
adding another testing-only seam.
