# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Security
- Adversarial review iteration 3 - privilege and identity bugs (#7)
- Adversarial review iteration 2 - deeper security analysis (#6)
- Adversarial security review and fix critical issues (#5)
- Fix critical and high priority issues found in adversarial review (#4)

### Added
- Add --passphrase flag to backup/restore for non-interactive use (#16)
- Add interactive credential fallback for CLI commands (#11)
- Add backup and restore CLI commands wrapping XMTP archive API (#30)
- Add JSON-aware config merge script for host Claude config layering (#18)
- Mount local ~/.claude config into devcontainer as bind mount (#17)
- Implement Tasks 8-11: Community Manager, Messaging, Invites, CLI (#1)

### Fixed
- Fix revoke-stale to use static XMTP API (avoid 10/10 catch-22) (#17)
- Debug PRAGMA key error with live credentials (#15)
- Backup must include SQLCipher salt file for restore (#13)
- Include private key material in backup/restore cycle (#12)
- Fix README recovery claims to match actual implementation (#10)
- Fix recoverIdentity poisoned key cache — store key only after XMTP DB verification (#9)
- use 12-byte IV for AES-256-GCM backup encryption (#4)
- cache keyring probe result across process restarts (#3)
- defer key storage until after recovery phrase confirmed (#2)
- Fix recoverAllCommunities: reorder sync + add polling loop (#29)
- Fix newline artifact on first character in composer (#23)
- Fix password stars rendering vertically on paste (#22)
- Gate channel create and invite actions behind admin role check (#21)
- Fix narrow terminal causing truncation and broken layout (#20)
- Fix terminal resize leaving UI artifacts (#19)
- Fix TUI theme colors for dark terminal readability (#15)
- Register custom codecs when creating XMTP client (#3)
- Fix env var loading + add integration tests with mocks (#2)

### Changed
- Add operational guidelines sections to CLAUDE.md (#6)
- Research XMTP network recovery after config loss (#27)
- Write README.md for the project (#16)
- Move maverick/ subdirectory to repo root for npm git install support (#14)
- Adversarial review: fix critical, high, and medium priority issues (#13)
- Full-workflow TUI: login, community list, screen router (#12)
- Polish TUI: multi-reply, cleanup, UX improvements (#11)
- Implement full-MVP TUI (#10)
- Revalidate decoded meta messages, validate role targets, fix chat error handling (#9)
- Add bounds to Zod schemas, fix expiry validation, fix role lookup mismatch (#8)
