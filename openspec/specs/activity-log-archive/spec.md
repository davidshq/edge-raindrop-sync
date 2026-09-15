# activity-log-archive Specification

## Purpose

Opt-in long-term activity log retention in IndexedDB, with export/clear controls and a soft cap, isolated from the recent chrome.storage activity list used by the status view.

## Requirements

### Requirement: Opt-in long-term activity archive
The extension SHALL support an opt-in long-term activity archive stored in IndexedDB, defaulting to disabled. When enabled and saved, each new activity log entry SHALL also be written to the archive. When disabled, new entries SHALL NOT be written to the archive; existing archive data SHALL remain until the user clears it.

#### Scenario: Enable long-term log
- **WHEN** the user enables “Keep long-term activity log” and saves settings
- **THEN** subsequent activity lines are stored in the IndexedDB archive in addition to the recent log

#### Scenario: Disable stops new archive writes
- **WHEN** the user disables long-term retention and saves
- **THEN** new activity lines update only the recent log
- **AND** previously archived entries remain until cleared

### Requirement: Export long-term activity log
The extension SHALL allow the user to export the long-term activity archive as a JSON download from the options Status section.

#### Scenario: Export archive
- **WHEN** the user clicks Export on the long-term activity controls
- **THEN** a JSON file download is produced containing the archived entries (at, level, message)

### Requirement: Clear long-term activity log
The extension SHALL allow the user to clear the long-term activity archive after an explicit confirmation in the options UI.

#### Scenario: Clear archive
- **WHEN** the user confirms Clear on the long-term activity controls
- **THEN** all IndexedDB archive entries are removed
- **AND** the recent `chrome.storage.local` activity list is left unchanged

### Requirement: Archive soft cap
The long-term archive SHALL enforce a maximum entry count; when exceeded, the oldest entries SHALL be removed so the archive stays within the limit.

#### Scenario: Cap enforced
- **WHEN** archive size would exceed the configured maximum after an append
- **THEN** oldest entries are deleted until the archive is within the limit

### Requirement: Archive failure isolation
Failures writing to or reading the long-term archive SHALL NOT prevent recent-log updates or sync engine progress.

#### Scenario: IndexedDB unavailable
- **WHEN** an IndexedDB append fails
- **THEN** the recent activity log is still updated
- **AND** sync continues
