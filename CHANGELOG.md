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
- Implement Tasks 8-11: Community Manager, Messaging, Invites, CLI (#1)

### Fixed
- Register custom codecs when creating XMTP client (#3)
- Fix env var loading + add integration tests with mocks (#2)

### Changed
- Adversarial review: fix critical, high, and medium priority issues (#13)
- Full-workflow TUI: login, community list, screen router (#12)
- Polish TUI: multi-reply, cleanup, UX improvements (#11)
- Implement full-MVP TUI (#10)
- Revalidate decoded meta messages, validate role targets, fix chat error handling (#9)
- Add bounds to Zod schemas, fix expiry validation, fix role lookup mismatch (#8)
