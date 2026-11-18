# Product Requirements Document
## Offline-First Worship Presentation and Song Management System

**Document status:** Revised specification  
**Version:** 1.1  
**Project name:** PraiseSuite

---

## Revision Notes (Version 1.1)

This revision incorporates decisions made after the initial specification:

- **Portable mode is Windows-only** and is packaged in the PortableApps.com Format (Section 3.1). macOS and Linux users use the installed application or the self-hosted server.
- **A standalone Android application** is added (Section 3.6), comparable in concept to OpenSongApp: self-contained, able to load OpenSong libraries, and able to present to an external display.
- **Database scope is clarified:** every client installation (installed desktop, portable, Android) uses SQLite as a single-user instance. PostgreSQL is used only by server deployments.
- **Web/PWA scope is clarified:** the installable web app is aimed at self-hosted and hosted instances served over HTTPS (Section 3.4).
- **Casting is reassessed** (Section 10): operating-system-level external displays and dedicated receiver devices are the primary routes; Google Cast is an optional adapter.
- **Backup is file-based first** (Section 11.3): the operating system's file picker is the first-release route to Google Drive, OneDrive, Dropbox, and similar providers; direct provider integrations are deferred. All platforms share one backup format.
- **Delivery phases** are updated and renumbered (Section 16).

---

## 1. Product Overview

### 1.1 Vision

Create a modern, extensible, offline-first worship presentation and music management system that provides a unified experience for managing songs, preparing services, presenting content, and supporting musicians.

The system should serve as a comprehensive successor to OpenSong, preserving the flexibility and simplicity that make OpenSong useful while addressing its limitations and introducing modern capabilities.

It should not be limited to projecting lyrics. It should be a complete worship-service content and presentation platform.

The system must work independently on a single computer, as a portable application, as a self-hosted server, through web browsers on computers, tablets, and phones, and as a standalone Android application.

### 1.2 Guiding Principles

1. **Offline first:** Core functionality must work without an internet connection.
2. **One unified system:** Songs, services, presentations, musician displays, and printed materials should share one underlying content model.
3. **Consistent experience:** Desktop, web, and mobile interfaces should share as much functionality and design as possible.
4. **Simple by default:** Common tasks should be approachable to nontechnical users. Advanced capabilities should be available without making everyday workflows complicated.
5. **Flexible deployment:** Users should be able to choose portable, installed, self-hosted, or hosted deployment without maintaining separate versions of their content.
6. **Extensible:** Integrations, import/export formats, presentation outputs, and additional content types should be supported through a documented extension architecture.
7. **Open interoperability:** Existing OpenSong libraries must be importable, and the system should not unnecessarily lock users into a proprietary format.
8. **Reliable presentation:** A presentation already loaded should continue working if the network, database server, or internet connection becomes unavailable.
9. **Shared source of truth:** Projected lyrics, musician charts, printed chord sheets, and digital songbooks should derive from the same canonical content.
10. **Same core everywhere:** The same core logic should run on the desktop, on the server, in browsers, and on Android, so that each can work offline and behave consistently.

---

## 2. Target Users and Roles

The system should accommodate several types of users, with permissions appropriate to their responsibilities.

### 2.1 Primary User Types

- **Administrator:** Manages application configuration, users, permissions, libraries, integrations, and backups.
- **Content editor:** Creates and maintains songs, media, and other library content.
- **Service planner:** Builds and organizes worship services.
- **Presenter:** Operates a live presentation and controls its progression.
- **Remote operator:** Controls a presentation from another device.
- **Musician:** Views song lyrics, chords, arrangements, and instrument-specific information.
- **Viewer:** Joins a session to view permitted content without controlling it.

A single person may have multiple roles.

### 2.2 Guest Access

The system should support joining a presentation session without creating an account.

Guest access must be configurable and may be disabled entirely.

Security requirements:

- Guests should receive only the permissions necessary for the session.
- Read-only access should be the default.
- Guests should not automatically receive access to the broader song library or administrative interface.
- Session invitations should be revocable and optionally expire.
- Session joining may require presenter approval.
- Administrators should be able to control whether guest access is available at all.

---

## 3. Deployment Models

The same application and core functionality should support multiple deployment models.

### 3.1 Portable Desktop Application (Windows)

A fully self-contained Windows application that can run from removable storage and is packaged in the PortableApps.com Format.

Portable mode is a Windows-only deliverable. macOS and Linux users use the installed application (Section 3.2) or the self-hosted server (Section 3.3).

Requirements:

- No installation required.
- Application, database, configuration, and media can reside on the removable drive.
- No persistent application data should be written to the host computer by default.
- The application should be able to run without administrator privileges.
- The user should be able to move the drive between compatible Windows computers, including computers that assign it a different drive letter.
- The application should detect and explain unsupported or unreliable storage configurations.
- Updates should be explicit and should not silently modify the portable installation.
- The user should be able to configure the database and media locations independently of the application executable.

PortableApps.com Format requirements:

- The portable package follows the PortableApps.com Format: a main folder containing App, Data, and Other directories, a launcher executable, and an installer distributed as a .paf.exe file.
- The package must run both standalone and from the PortableApps.com Platform menu.
- The application folder must be replaceable during an update while the data folder is preserved. A new version must therefore migrate existing data on first launch, create an automatic backup before migrating, and refuse to open data created by a newer version.
- Stored content must not depend on absolute paths or drive letters.
- The application must shut down promptly and cleanly when the PortableApps.com Platform closes it or the drive is ejected.
- Only one computer may have the portable data open for writing at a time; the application should detect this and explain it.
- The supported target is 64-bit Windows 10 and Windows 11. Removable drives formatted as NTFS or exFAT are supported; FAT32 is discouraged because of its 4 GB file-size limit, which affects large media files.
- Listing in the official PortableApps.com directory is optional and is a distribution decision, not a technical requirement.

An optional caching mode may be offered, but the default portable mode must remain self-contained.

### 3.2 Installed Desktop Application

A conventional installed application for Windows, macOS, and Linux.

Requirements:

- Local database and media storage (SQLite).
- Single-user by design: the desktop application never requires a separate database server.
- Full offline operation.
- Optional LAN access for phones, tablets, and other computers.
- Optional connection to a remote server for synchronization.
- Native display output support where feasible.
- Same core interface and capabilities as the web application.

### 3.3 Self-Hosted Server

A headless deployment suitable for a church or organization.

Requirements:

- Docker Compose deployment should be supported.
- PostgreSQL is the primary server database. It is used only by server deployments; desktop, portable, and Android installations always use SQLite and never require a database server.
- Browser-based access from computers, tablets, and phones.
- Centralized library and service management.
- Multiple simultaneous presentation sessions.
- Local network operation without internet access.
- Optional remote access through an appropriately secured connection.
- Support for backup and synchronization.
- No requirement for a dedicated desktop environment.

### 3.4 Web Application

The web interface should be usable from modern browsers.

Requirements:

- Responsive layouts for desktop, tablet, and mobile.
- Core management and presentation functionality should not be artificially restricted compared with the desktop application.
- Offline capabilities should be provided where practical through local caching and service-worker functionality.
- A browser should be able to act as a presentation receiver without installing the full application.
- The installable web app (PWA) is intended primarily for self-hosted and hosted instances served over HTTPS. Browsers restrict offline caching and some device features (such as keeping the screen awake) on plain-HTTP local-network addresses. The product must document these limits and offer the Android application (Section 3.6) as the full-featured option on such networks.

### 3.5 Local Desktop as a Server

An installed desktop application should optionally expose its local application interface and services over the LAN.

For example:

1. The application runs on the presentation computer.
2. It exposes a local web interface.
3. A phone or tablet joins the same network.
4. The user scans a QR code or enters a short session code.
5. The phone connects directly to the presentation computer.
6. The phone can act as a remote control or musician display.

This should work without requiring a separate server or internet access.

On Windows, the first time the application listens on the network, the operating system may display a firewall prompt that requires administrator approval. The application should explain this and show clearly when LAN access is unavailable for that reason.

### 3.6 Android Application

A standalone Android application provides a self-contained experience comparable to OpenSongApp: it runs entirely on the device, loads existing OpenSong libraries, and can present to an external display.

Requirements:

- Works fully offline with a local library on the device. No server or account is required.
- Uses the same core logic, content model, and interface design as the other deployments.
- Imports OpenSong data from a zip archive or a user-selected folder through the standard staged import workflow (Section 5). Imported content is stored in the application's own library rather than read live from the source folder.
- Can present to an external display (Section 10.4).
- Can also act as a remote control, a musician display, a digital songbook, and a display receiver.
- Synchronizes with a server on request (Section 11.2).
- Backs up and restores through the operating system's file picker (Section 11.3).
- Keeps the screen awake during sessions and preserves session state when the application is suspended or interrupted.
- Provides a receiver mode suitable for Android TV and Fire TV devices (later phase).
- Hosting a session for other devices directly from the Android device is a later capability.

iOS and iPadOS are served by the installable web app. A native iOS application is not planned.

The Android application is not required for the first release.

### 3.7 Platform Support Summary

| Platform | Installed application | Portable | Server | Browser / PWA client |
|---|---|---|---|---|
| Windows | Yes | Yes (PortableApps.com Format) | Via Docker | Yes |
| macOS | Yes | No | Via Docker | Yes |
| Linux | Yes | No | Yes (Docker) | Yes |
| Android | Yes (standalone app) | Not applicable | No | Yes |
| iOS / iPadOS | No (web app only) | Not applicable | No | Yes |

---

## 4. Content and Library Management

### 4.1 Content Types

The initial system should support:

- Songs
- Song sections and arrangements
- Scripture passages
- Service plans
- Images and backgrounds
- Video and audio media
- Presentation themes and layouts
- Supporting attachments and metadata

The content architecture should allow additional types to be introduced through extensions.

### 4.2 Song Management

Songs are a core feature and must receive particular attention.

Each song should support:

- Title
- Author and copyright information
- CCLI number and other identifiers
- Default musical key
- Tempo
- Time signature
- Lyrics
- Sections such as verses, choruses, bridges, intros, endings, and tags
- Chords
- Arrangement instructions
- Tags and categories
- Associated media
- Notes
- Multiple arrangements
- Song history and revisions

Songs should have stable internal identifiers independent of their title or filename.

### 4.3 Chord Notation

The system must support traditional OpenSong dot-based chord notation.

Requirements:

- Import existing OpenSong chord placement without losing positioning.
- Edit source notation directly.
- Display chords above the appropriate lyric positions.
- Support common chord types, slash chords, alternate bass notes, and custom chord names.
- Support chord transposition.
- Support capo information.
- Support chord diagrams where available.
- Preserve chord placement when lyrics are edited where practical.

### 4.4 Song Editing

Two complementary editing experiences are required.

**Source editor**

- Familiar text-based editing.
- OpenSong-compatible notation.
- Direct control over song structure and chord placement.
- Suitable for users who prefer working with the underlying source.

**Visual editor**

- Edit lyrics directly.
- Insert, move, and remove chords at specific lyric positions.
- Add, remove, rename, and rearrange sections.
- Preview the resulting chord sheet.
- Edit metadata and arrangement information.

Both editors must operate on the same canonical song data. They must not create separate incompatible versions of a song.

### 4.5 Arrangements and Instruments

A song should be reusable across different musical arrangements.

An arrangement may define:

- Section order and repetition.
- Intro and ending instructions.
- Tempo and time signature.
- Musical cues.
- Instrument-specific information.
- Chord variations or voicings.
- Capo settings.
- Transposition preferences.

Instrument-specific charts should be possible without duplicating the underlying song lyrics.

For example:

- Guitar: capo 2, alternate chord voicings, guitar-friendly chord names.
- Piano: concert-pitch chords and full lyrics.
- Drums: section names, count-ins, transitions, and arrangement notes.

The system should distinguish between the song's original musical information and an instrument's preferred presentation of that information.

---

## 5. OpenSong Compatibility and Import/Export

OpenSong migration is a first-class feature, not an afterthought.

### 5.1 Import Requirements

Support importing:

- Individual OpenSong song files.
- Entire OpenSong libraries and folders.
- Zip archives of OpenSong libraries or folders (the primary route on Android, where the operating system restricts arbitrary folder access).
- Song metadata.
- Sets and service-related data where the source format provides it.
- Background images.
- Other associated media.
- Relevant configuration and supporting resources where practical.

### 5.2 Import Workflow

Importing should be a staged process:

1. Select or upload files/folders.
2. Identify the source format.
3. Analyze the contents.
4. Preview detected songs, sets, and resources.
5. Validate files and report potential issues.
6. Identify duplicates.
7. Allow the user to choose how duplicates are handled.
8. Perform the import.
9. Provide a detailed import report.

The original files should optionally be retained until the user confirms that migration is successful.

### 5.3 Duplicate Resolution

Duplicate detection should consider more than filenames.

Possible matching criteria:

- Existing identifiers.
- Titles and authors.
- Normalized lyrics.
- CCLI numbers.
- Content similarity (for example, comparing normalized lyric text so that punctuation, capitalization, and chord notation do not hide a duplicate).

The user should be able to:

- Skip duplicates.
- Replace existing content.
- Import as a separate song.
- Merge selected metadata or content where safe.

### 5.4 Export Requirements

The system should support exporting songs and libraries in OpenSong-compatible formats.

OpenLyrics should also be evaluated as an interoperability format.

The architecture should allow additional import/export adapters for formats such as OpenLP, EasyWorship, and ProPresenter.

Export compatibility should be documented honestly: unsupported features should be reported rather than silently discarded.

---

## 6. Songbooks and Chord Sheets

### 6.1 Print Songbooks

Printing is a first-class feature.

The system should provide configurable layouts for:

- Chord sheets.
- Lyrics-only sheets.
- Musician charts.
- Multi-song documents.
- Service-specific song collections.
- Instrument-specific charts.

Configuration should include:

- Paper size.
- Orientation.
- Margins.
- Font family and size.
- Line spacing.
- Section spacing.
- Chord placement and styling.
- Multiple columns.
- Page numbering.
- Song metadata.
- Headers and footers.
- Chord diagrams.
- Key and capo information.

Users should be able to transpose a song before generating a printout.

PDF export and direct printing should be supported.

### 6.2 Digital Songbook

The digital songbook should use the same underlying layout engine as the print version.

It should work on:

- iPads and other tablets.
- Phones.
- Laptops.
- Desktop browsers.

Features:

- Responsive layout.
- Portrait and landscape support.
- Adjustable font size.
- Dark and light themes.
- Full-screen mode.
- Screen-awake option.
- Automatic scrolling.
- Section navigation.
- Bookmarks.
- Offline access to downloaded content.
- Instrument-specific views.
- Key, capo, and transposition controls.

### 6.3 Whole-Song and Current-Section Views

Both viewing modes are required.

**Whole-song mode:** Displays the complete song, allowing musicians to see the structure and upcoming sections.

**Current-section mode:** Displays the currently active section of the song, following the presentation's musical position.

The musician should be able to choose their preferred mode.

---

## 7. Service Planning

### 7.1 Service Definition

A Service represents planned content for an event.

A service may contain:

- Songs.
- Scripture passages.
- Announcements.
- Videos.
- Images.
- Other presentation content.
- Notes and instructions.
- Ordering and timing information.

A service should be reusable, duplicable, and editable independently of a live presentation.

### 7.2 Service Organization

Users should be able to:

- Create services.
- Duplicate previous services.
- Reorder content.
- Add notes and instructions.
- Assign content to presentation outputs.
- Select song arrangements.
- Prepare content ahead of time.
- Launch a service into a live presentation session.

A service is a plan, not the live state of a presentation.

---

## 8. Presentation Sessions

### 8.1 Service vs. Presentation Session

The system must distinguish between:

**Service:** The planned content and its intended order.

**Presentation Session:** A live instance of a service, including its current position, connected devices, output configurations, and control state.

This distinction is essential.

### 8.2 Multiple Simultaneous Sessions

Multiple independent presentation sessions are a core requirement.

Examples:

- Main sanctuary.
- Fellowship hall.
- Children's church.
- Youth room.
- Separate events running simultaneously.

Each session should have independent:

- Current position.
- Connected devices.
- Output configuration.
- Control permissions.
- Session settings.

Sessions may use the same service or different services.

### 8.3 Multiple Outputs per Session

A session may have multiple outputs, such as:

- Main projector.
- Confidence monitor.
- Stage display.
- Overflow display.
- Musician display.
- Browser-based receiver.

Each output may have its own configuration and content representation.

Outputs may follow the session's current position or operate independently where appropriate.

### 8.4 Joining Sessions

Devices should be able to join an existing session through:

- QR code.
- Short session code.
- Direct URL.
- LAN discovery where supported.

Devices should be able to reconnect after temporary network interruptions.

Session state should be recoverable after an application restart where practical.

### 8.5 Remote Control

The system should support remote control from phones, tablets, and computers.

Controls may include:

- Next and previous.
- Select a slide or section.
- Jump to a song.
- Select a service item.
- Start and stop presentation.
- Blank or clear output.
- Control output-specific behavior.

### 8.6 Control Ownership

Multiple connected users should not create uncontrolled competing presentation changes.

The system should support configurable roles and control permissions.

Possible behavior:

- One designated presenter.
- Multiple authorized remote operators.
- Read-only viewers.
- Explicit control handoff.
- Administrator override.

The system should make it clear who currently has control.

---

## 9. Musician Displays

### 9.1 Separate Presentation Output

Musician displays are a core output type, not simply another projector screen.

The main presentation and musician display must not depend on identical slide numbers or identical text chunking.

Instead, both should be linked through shared musical structure.

### 9.2 Musical Position Synchronization

A musician display should be able to follow the current musical position of the presentation.

For example:

- The projector displays two lines of a chorus.
- The guitarist sees the entire chorus with chords.
- The drummer sees the current section and an upcoming transition cue.
- The pianist sees the complete song with lyrics and concert-pitch chords.

These displays should remain synchronized by song section and section instance, not by slide number.

Repeated sections must be distinguishable. If a chorus occurs twice, the system must know which occurrence is currently active.

### 9.3 Follow Modes

Each musician device should independently support:

- **Follow presentation:** Automatically follows the active musical position.
- **Independent:** Musician navigates without affecting the presentation.
- **Hybrid:** Follows automatically but permits temporary manual navigation, with optional automatic return to following after a configured interval.

Musician navigation must never accidentally advance the main projector.

### 9.4 Instrument Profiles

Each device should be able to select an instrument profile.

Profiles may control:

- Transposition.
- Capo.
- Chord voicings.
- Displayed information.
- Layout.
- Scrolling behavior.
- Current-section or whole-song mode.
- Arrangement notes.

Multiple devices may use different profiles while following the same session.

### 9.5 Future Musician Features

The architecture should allow future additions such as:

- Metronome.
- Tempo display.
- Time signature.
- Count-ins.
- Section-specific cues.
- Click tracks.
- Backing tracks.
- Instrument-specific notes.

These are not prerequisites for the initial release.

---

## 10. Presentation Outputs and Casting

### 10.1 Native Display Output

The desktop application should support extended desktop displays where feasible.

Users should be able to assign presentation outputs to available monitors.

On Android, outputs may be assigned to external displays that the operating system exposes as secondary displays (Section 10.4).

### 10.2 Browser Receiver

A browser-based receiver is a high-priority output.

A display should be able to join a presentation using a modern browser without installing the complete application.

This enables:

- Smart TVs with browsers.
- Spare laptops.
- Tablets.
- Secondary computers.
- Network-connected display devices.

A small dedicated receiver device (for example, a low-cost computer or an Android TV or Fire TV box running a browser or receiver app in kiosk mode) is a supported and recommended way to drive a television or projector without relying on casting protocols.

### 10.3 External Casting

The architecture should support output adapters for external display technologies.

Candidates include:

- Google Cast.
- Roku.
- Samsung TV platforms.
- Miracast.
- Other network display receivers.

Each technology requires an individual feasibility assessment.

Miracast should be treated as an operating-system-level display mechanism rather than assumed to work like a browser-based or Google Cast receiver.

The product should not promise universal casting support until each target has been tested.

Findings to date, to be confirmed by testing on target hardware:

- Display output through the operating system (HDMI or USB-C display adapters, Miracast or wireless displays, and screen mirroring) is the most practical route on Android and works without internet access. Behavior varies by device manufacturer and Android version.
- Google Cast custom receivers must be registered with Google, and the published receiver web app must be served over HTTPS. In practice this is likely to require internet access when the presentation starts, which conflicts with offline-first operation. Google Cast should therefore be treated as an optional adapter for online-capable environments, not a core output.
- The default Cast media receiver cannot display custom presentation content.
- Roku and Samsung (Tizen) platforms require platform-specific applications and are deferred.

### 10.4 Android External Displays

The Android application should be able to present to any external display that the operating system exposes as a secondary display, including HDMI and USB-C display adapters, Miracast or wireless displays, and, where the device supports it, screen-mirrored Cast devices.

Requirements:

- Detect displays that are connected before or during a session, and handle disconnection and reconnection.
- Show presentation content on the external display independently of what is shown on the device screen, so the device can act as a controller or musician view while the external display shows projected content.
- Provide output options comparable to OpenSongApp: background image or color, logo, margins, rotation, maximum automatic text size, and an optional information bar and clock.
- Support both whole-song and current-section display modes.
- Provide an on-device preview that simulates the external output, for rehearsal and testing without a connected display.

---

## 11. Synchronization and Offline Operation

### 11.1 Offline Operation

Core functions must work without internet access.

A loaded presentation must not depend on continuous connectivity to a central server.

Local content should be available to the presentation engine even if synchronization services are unavailable.

### 11.2 Synchronization

The system should support synchronization between installations.

Examples:

- A central server and a presentation laptop.
- Two desktop installations.
- A portable installation and a home computer.
- A self-hosted server and remote devices.

Requirements:

- Bidirectional synchronization.
- Incremental transfer.
- Stable object identifiers.
- Revision tracking.
- Conflict detection.
- Automatic merging where safe.
- User-assisted conflict resolution when necessary.
- Media synchronization.
- Recovery after interrupted synchronization.
- Mobile devices synchronize on user request by default, with an option to limit media transfer to Wi-Fi.

Timestamps alone must not determine which version wins.

### 11.3 Backup and Restore

Backup is separate from synchronization.

The system should support:

- Scheduled backups.
- Manual backups.
- Versioned backups.
- Retention policies.
- Full and incremental backup strategies.
- Database-consistent snapshots.
- Media and attachment backups.
- Selective restore.
- Full installation restore.
- Backup verification.
- A common backup format that restores on any supported platform (for example, a backup made on Android can be restored on a desktop installation).

Initial destinations:

- Local disk and external USB storage.
- Network shares.
- Another server.
- The operating system's file picker ("Save backup to..." and "Restore from file..."). On Android this provides access to Google Drive, OneDrive, Dropbox, and other providers whose apps are installed, without the product needing its own provider sign-in, developer registration, or API integration.
- Folders synchronized by a cloud provider's own desktop client, which appear as ordinary local directories.

Later destinations, added incrementally:

- WebDAV.
- S3-compatible storage.
- Direct integration with Google Drive, OneDrive, and Dropbox.

Direct provider integrations are deferred because they require developer registration, sign-in flows, and provider review processes. The file-based approach is simpler, more robust, and works with providers the product has never heard of. Its limitation is that it is manual: it does not support unattended scheduled backups from Android to a cloud provider.

Backups that will be stored with external cloud providers should be encrypted before they leave the device, using user-controlled keys. Because a file saved through the file picker can end up with any provider, the backup flow should offer encryption every time a backup is saved.

---

## 12. Extensions and Integrations

### 12.1 Extension Philosophy

The core application should remain focused and approachable.

Additional functionality should be added through extensions rather than making every feature mandatory.

### 12.2 Extension Categories

The architecture should accommodate:

- Content providers.
- Import/export formats.
- Presentation outputs.
- Media integrations.
- Scripture providers.
- Planning tools.
- External automation integrations.
- Additional presentation capabilities.

Examples include:

- Home Assistant.
- Online scripture providers.
- External media libraries.
- Chromecast-related integrations.
- Advanced stage displays.
- Video playback extensions.

### 12.3 Plugin Security

Extensions should not automatically receive unrestricted access to the application or host computer.

The system should distinguish between:

- Trusted native extensions.
- Restricted or sandboxed web extensions.
- External integrations using documented APIs.

Permissions should be explicit.

### 12.4 API

A documented API should be designed early.

It should support:

- Content retrieval.
- Service management.
- Session management.
- Presentation control.
- Device connections.
- Output registration.
- Extension integration.

The API should be stable enough to support alternative clients and external tools.

API versioning must allow older installed clients, such as the Android application, to keep working with newer servers within a documented support window.

---

## 13. Multi-Organization Readiness

The architecture should be designed so that multiple organizations can eventually be supported.

This does not mean implementing a full multi-tenant management system in the first release.

The underlying data model should distinguish:

- Users.
- Organizations.
- Content ownership.
- Content visibility.
- Permissions.
- Shared resources.

This avoids making future multi-organization support unnecessarily difficult.

---

## 14. Future Online Features

The core product should not depend on online services, but the architecture should leave room for:

- Shared online song libraries.
- Online song metadata retrieval.
- CCLI integration, subject to licensing and API availability.
- Online scripture providers.
- Shared church libraries.
- Remote service planning.
- Cloud backup.
- Optional hosted service.

A hosted offering may eventually be available, but self-hosting and local use must remain viable.

---

## 15. Non-Functional Requirements

### Reliability
- Presentations should continue if internet access is lost.
- Local content should not depend on a remote database during live presentation.
- Interrupted imports and synchronization should be recoverable.
- Backups should be verifiable.
- The Android application should preserve session state across app suspension and screen-off events.

### Performance
- Common interface actions should feel immediate.
- Song and service loading should not introduce noticeable presentation delays.
- Large libraries should remain manageable.
- Media should be loaded and prepared ahead of presentation where appropriate.

### Usability
- The interface should be usable by nontechnical volunteers.
- Common workflows should require minimal configuration.
- Advanced features should be discoverable without overwhelming basic users.
- Mobile interfaces should be touch-friendly.

### Accessibility
- Keyboard navigation.
- Screen-reader-friendly controls.
- Adequate contrast.
- Scalable text.
- Clear focus indicators.
- Accessible presentation controls.

### Portability
- Support Windows, macOS, and Linux desktop environments.
- Support Android phones and tablets with a standalone application.
- Offer portable operation on Windows only, packaged in the PortableApps.com Format.
- Support common removable storage formats for Windows portable use (NTFS and exFAT; FAT32 is discouraged because of its 4 GB file-size limit).
- Avoid filesystem-specific assumptions.

### Security
- Authentication for administrative functions.
- Configurable guest access.
- Explicit permissions.
- Secure remote access.
- Protected backup credentials.
- Restricted plugin capabilities.
- No unnecessary background services.
- Unencrypted (HTTP) network access on Android only when the user enables it for a local-network server.

---

## 16. Proposed Delivery Phases

The following phases are a suggested implementation order, not a reduction of the overall product vision.

### Phase 1 — Core Foundation
- Canonical data model.
- Local database.
- Song library.
- OpenSong import.
- Song source editor.
- Basic visual song editor.
- Service planning.
- Basic presentation engine.
- Local desktop operation.
- Basic browser interface.

### Phase 2 — Presentation and Musician Experience
- Presentation sessions.
- Multiple simultaneous sessions.
- Multiple outputs per session.
- Remote controls.
- Browser receiver.
- Musician displays.
- Section-based synchronization.
- Instrument profiles.
- QR/session-code joining.

### Phase 3 — Songbooks and Publishing
- Print layouts.
- PDF export.
- Digital songbook.
- Shared print/digital layout engine.
- Transposition and capo-aware output.
- Advanced chord-sheet formatting.

### Phase 4 — Synchronization and Deployment
- Bidirectional sync.
- Headless server deployment.
- Docker Compose.
- Windows portable mode in the PortableApps.com Format.
- Backup and restore.
- Device reconnection.
- Offline synchronization workflows.

### Phase 5 — Android Application
- Android client with the shared interface.
- Standalone local library and OpenSong zip and folder import.
- External display output (HDMI, Miracast, screen-mirrored Cast devices).
- Remote control, musician display, and digital songbook with native conveniences (keep-awake, server discovery, QR scanning).
- Synchronization with a server on request.
- Backup and restore through the system file picker.
- Android TV and Fire TV receiver.
- Hosting sessions from the Android device.

### Phase 6 — Extensions and Integrations
- Public extension API.
- Plugin management.
- Home Assistant integration.
- Additional import/export formats.
- Additional presentation receivers, including an optional Google Cast adapter.
- Additional backup destinations (WebDAV, S3-compatible, and direct Google Drive, OneDrive, and Dropbox integrations).
- Online service integrations.

### Phase 7 — Hosted and Organizational Features
- Optional hosted service.
- Multi-organization management.
- Shared online libraries.
- Cloud collaboration.
- Advanced administration.

---

## 17. Initial Release Acceptance Criteria

The first meaningful release should demonstrate that the core concept works end to end.

A user should be able to:

1. Run the application locally without internet access.
2. Import an existing OpenSong library.
3. Find, create, and edit songs.
4. Preserve and edit chord placement.
5. Build a service using songs from the library.
6. Present lyrics on an external display.
7. Connect another device through a browser.
8. Control the presentation remotely.
9. Access the same library through the shared web interface.
10. Close and reopen the application without losing content.

The initial release does not need every future integration or advanced presentation technology, but its architecture must not prevent those features from being added later.

Windows portable packaging and the Android application are later deliverables and are not required for the first release. The first release must not prevent them, for example by depending on desktop-only code in the core logic or on absolute file paths in stored content.