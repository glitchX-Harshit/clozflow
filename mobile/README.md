# Clozflow Mobile

Clozflow is an AI Sales Assistant mobile client built with Flutter.

## Prerequisites

- Flutter SDK ^3.5.0
- Android Studio (for Android development)
- Xcode (for iOS development)

## Setup Instructions

1. Copy the `.env.example` file to `.env` and configure your environment variables:
   ```bash
   cp .env.example .env
   ```
2. Get Flutter dependencies:
   ```bash
   flutter pub get
   ```
3. Generate code files:
   ```bash
   dart run build_runner build -d
   ```

## Development Workflow

- Run the app:
  ```bash
  flutter run
  ```
- Android Emulator Networking Notes:
  To connect to a local backend from the Android emulator, use `http://10.0.2.2:8000` instead of `localhost`.

## Architecture Overview

This project uses:
- Feature-first architecture
- **Riverpod** for state management and dependency injection
- **Go Router** for navigation and routing
- **Dio** for HTTP networking
- **Supabase** for authentication and real-time database

## Design System
- Fonts: Outfit / Inter
- Brand Colors: Sapphire Navy (`#1e40af`), Electric Blue (`#3b82f6`)

## Testing Instructions

Run tests using:
```bash
flutter test
```
