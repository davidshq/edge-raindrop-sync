## MODIFIED Requirements

### Requirement: Opt-in long-term activity archive
The extension SHALL support an opt-in long-term activity archive stored in IndexedDB, defaulting to disabled. When enabled and saved, each activity log entry produced by the recent-log write SHALL also be stored in the archive, including `ats` when present. When the newest archive row has the same level and message, the extension SHALL update that row instead of inserting another. When disabled, new entries SHALL NOT be written to the archive; existing archive data SHALL remain until the user clears it.

#### Scenario: Enable long-term log
- **WHEN** the user enables “Keep long-term activity log” and saves settings
- **THEN** subsequent activity lines are stored in the IndexedDB archive in addition to the recent log

#### Scenario: Disable stops new archive writes
- **WHEN** the user disables long-term retention and saves
- **THEN** new activity lines update only the recent log
- **AND** previously archived entries remain until cleared

#### Scenario: Consecutive archive rows coalesce
- **WHEN** long-term logging is on and the same level and message are logged again as the newest archive row
- **THEN** the archive still has one row for that run
- **AND** that row’s `at` and `ats` match the coalesced recent-log entry

### Requirement: Export long-term activity log
The extension SHALL allow the user to export the long-term activity archive as a JSON download from the options Status section.

#### Scenario: Export archive
- **WHEN** the user clicks Export on the long-term activity controls
- **THEN** a JSON file download is produced containing the archived entries (`at`, `level`, `message`, and `ats` when that entry was coalesced)
