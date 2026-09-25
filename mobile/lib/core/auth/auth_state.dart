import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:clozflow/core/auth/auth_service.dart';

/// Authentication status across the application.
enum AuthStatus { initial, authenticated, unauthenticated, loading, error }

/// Immutable authentication state.
class AppAuthState {
  final AuthStatus status;
  final User? user;
  final Session? session;
  final String? errorMessage;

  const AppAuthState({
    this.status = AuthStatus.initial,
    this.user,
    this.session,
    this.errorMessage,
  });

  /// Create a copy with optional overrides.
  /// Pass explicit null via the clearUser/clearSession/clearError flags.
  AppAuthState copyWith({
    AuthStatus? status,
    User? user,
    bool clearUser = false,
    Session? session,
    bool clearSession = false,
    String? errorMessage,
    bool clearError = false,
  }) {
    return AppAuthState(
      status: status ?? this.status,
      user: clearUser ? null : (user ?? this.user),
      session: clearSession ? null : (session ?? this.session),
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }

  bool get isAuthenticated => status == AuthStatus.authenticated;
  String? get currentToken => session?.accessToken;
}

/// Global auth state notifier. Listens to Supabase auth changes and
/// updates state reactively. The router watches this to handle redirects.
final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AppAuthState>((ref) {
  return AuthNotifier(ref.watch(authServiceProvider));
});

class AuthNotifier extends StateNotifier<AppAuthState> {
  final AuthService _authService;
  StreamSubscription<AuthState>? _authStateSubscription;

  AuthNotifier(this._authService) : super(const AppAuthState()) {
    _init();
  }

  void _init() {
    // Check for existing session immediately
    final currentSession = _authService.getCurrentSession();
    final currentUser = _authService.getCurrentUser();

    if (currentSession != null && currentUser != null) {
      if (currentSession.isExpired) {
        _refreshToken();
      } else {
        state = AppAuthState(
          status: AuthStatus.authenticated,
          user: currentUser,
          session: currentSession,
        );
      }
    } else {
      state = const AppAuthState(status: AuthStatus.unauthenticated);
    }

    // Subscribe to future auth state changes
    _authStateSubscription = _authService.onAuthStateChange.listen(
      (data) {
        final session = data.session;
        final event = data.event;

        if (event == AuthChangeEvent.signedIn ||
            event == AuthChangeEvent.tokenRefreshed) {
          state = AppAuthState(
            status: AuthStatus.authenticated,
            user: session?.user,
            session: session,
          );
        } else if (event == AuthChangeEvent.signedOut ||
            event == AuthChangeEvent.userDeleted) {
          state = const AppAuthState(
            status: AuthStatus.unauthenticated,
          );
        }
      },
      onError: (error) {
        state = AppAuthState(
          status: AuthStatus.error,
          errorMessage: error.toString(),
        );
      },
    );
  }

  Future<void> _refreshToken() async {
    try {
      final response = await _authService.refreshSession();
      if (response.session != null) {
        state = AppAuthState(
          status: AuthStatus.authenticated,
          user: response.user,
          session: response.session,
        );
      } else {
        state = const AppAuthState(
          status: AuthStatus.unauthenticated,
        );
      }
    } catch (_) {
      state = const AppAuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Session expired. Please sign in again.',
      );
    }
  }

  /// Sign out the current user.
  Future<void> signOut() async {
    try {
      await _authService.signOut();
    } catch (_) {
      // Even if sign-out fails server-side, clear local state
      state = const AppAuthState(status: AuthStatus.unauthenticated);
    }
  }

  @override
  void dispose() {
    _authStateSubscription?.cancel();
    super.dispose();
  }
}
