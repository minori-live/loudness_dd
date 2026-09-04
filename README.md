# Loudness DD

<p align="center">
  <strong>📊 LUFS-based Tab Volume Balancer for Chrome</strong>
</p>

<p align="center">
  A Chrome extension that automatically balances audio levels across browser tabs using professional broadcast-standard LUFS measurement.
</p>

<p align="center">
  For autonomous coding agents and contributors, see <a href="./AGENT.md"><strong>AGENT.md</strong></a>.
</p>

---

## ✨ Features

### Real-time LUFS Metering

- **ITU-R BS.1770-4 compliant** loudness measurement
- K-weighted filtering for perceptual accuracy
- Displays momentary, short-term, and integrated loudness
- Visual loudness meters with color-coded level indicators

### Auto Volume Balancing

- Starts automatically whenever a tab is registered
- Keeps monitored tabs balanced in real time as content changes
- Supports multiple target presets:
  - 📺 **Broadcast** (-24 LUFS)
  - 🎧 **Streaming** (-14 LUFS)
  - 🎙️ **Podcast** (-16 LUFS)
  - 🔊 **Loud** (-9 LUFS)

### Output Limiter

- Prevents clipping when multiple loud sources play simultaneously
- Configurable ceiling threshold (-6 dB to -0.1 dB)
- Advanced controls: Attack, Release, and Knee parameters
- Protects your ears and speakers from unexpected volume spikes

### Tab Management

- Register and monitor multiple tabs simultaneously
- Per-tab volume control with mute/unmute
- Solo and Focus modes: mute other monitored tabs, or lower them by 12 dB
- Optional auto-focus follows the active monitored tab
- Visual indicators for active captures
- Clean, modern dark UI optimized for quick adjustments

## 🛠️ Tech Stack

- **Vue 3** with Composition API
- **TypeScript** for type safety
- **Pinia** for state management
- **Vite** + **CRXJS** for Chrome extension development
- **Rust** + **WebAssembly** for the real-time LUFS analysis kernel
- **Web Audio API** for real-time audio processing
- **Chrome Extension Manifest V3**

## 📦 Installation

### From Source

1. **Clone the repository**

   ```bash
   git clone https://github.com/dsh0416/loudness_dd.git
   cd loudness_dd
   ```

2. **Install the locked toolchain and dependencies**

   ```bash
   mise install
   mise run install
   ```

3. **Build the extension**

   ```bash
   mise run build
   ```

4. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### Development

```bash
# Start dev server with hot reload
mise run dev

# Run unit tests
mise run test

# Rebuild the Rust WebAssembly module after editing crates/lufs-meter
pnpm wasm:build

# Run every CI check locally
mise run check

# Apply formatting or lint fixes
mise run format
mise run lint-fix
```

Node, pnpm, actionlint, and ShellCheck are pinned in `mise.toml` and checksummed for
supported platforms in `mise.lock`.

### Continuous Integration and Releases

Pull requests and pushes to `main` run reusable Test and Build workflows in parallel.
The stable `Gate` job is the single branch-protection check: it succeeds only when
formatting, workflow linting, ESLint, type checking, unit tests, and extension packaging
all pass. Build archives are retained as workflow artifacts for 14 days.

Pushing a tag matching the `package.json` version (for example `v1.1.0`) reruns Test and
Build, generates SHA-256 checksums and artifact provenance, and creates a draft GitHub
Release containing the versioned extension zip.

## 🎯 Usage

1. **Click the extension icon** to open the popup
2. **Navigate to a tab** with audio content (YouTube, Spotify, etc.)
3. **Click "Register Current Tab"** to start capturing audio and automatic balancing
4. **Repeat** for other tabs you want to monitor
5. **Adjust the target LUFS** using the slider or presets

## 📐 How It Works

### LUFS Measurement

The extension implements the ITU-R BS.1770-5 algorithm:

1. **K-weighting Filter**: A Rust/WebAssembly two-stage biquad filter (high-shelf + high-pass) that models human frequency perception
2. **Block Processing**: 400ms overlapping blocks with 75% overlap for smooth measurements
3. **Gating**: Excludes quiet passages (-70 LUFS absolute threshold) and applies relative gating (-10 LU) for integrated loudness

### Audio Capture

- Uses Chrome's `tabCapture` API to intercept tab audio
- Offscreen document processes audio in the background
- Real-time gain adjustment through Web Audio API nodes

## 🔧 Permissions

The extension requires the following permissions:

| Permission   | Purpose                         |
| ------------ | ------------------------------- |
| `tabCapture` | Capture audio from browser tabs |
| `tabs`       | Access tab information          |
| `activeTab`  | Interact with the current tab   |
| `offscreen`  | Background audio processing     |
| `storage`    | Save user preferences           |

## 📄 License

MIT

## 👤 Author

[@dsh0416](https://github.com/dsh0416)

---

<p align="center">
  <em>Make your browsing experience sonically balanced 🎵</em>
</p>
