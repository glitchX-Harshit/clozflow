import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:clozflow/core/auth/auth_state.dart';
import 'package:clozflow/features/auth/screens/splash_screen.dart';
import 'package:clozflow/features/auth/screens/login_screen.dart';
import 'package:clozflow/features/auth/screens/signup_screen.dart';
import 'package:clozflow/features/shell/screens/shell_screen.dart';
import 'package:clozflow/features/dashboard/screens/dashboard_screen.dart';
import 'package:clozflow/features/prospects/screens/prospects_screen.dart';
import 'package:clozflow/features/calls/screens/calls_screen.dart';
import 'package:clozflow/features/insights/screens/insights_screen.dart';
import 'package:clozflow/features/settings/screens/settings_screen.dart';

class RouterNotifier extends ChangeNotifier {
  final Ref _ref;

  RouterNotifier(this._ref) {
    _ref.listen<AppAuthState>(
      authNotifierProvider,
      (previous, next) {
        if (previous?.status != next.status) {
          notifyListeners();
        }
      },
    );
  }
}

final routerNotifierProvider = Provider<RouterNotifier>((ref) {
  return RouterNotifier(ref);
});

final appRouterProvider = Provider<GoRouter>((ref) {
  final notifier = ref.watch(routerNotifierProvider);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: notifier,
    debugLogDiagnostics: false,
    redirect: (context, state) {
      final authState = ref.read(authNotifierProvider);
      final isAuth = authState.isAuthenticated;
      final location = state.matchedLocation;
      final isSplash = location == '/splash';
      final isAuthRoute = location == '/login' || location == '/signup';

      // While auth state is loading, stay on splash
      if (authState.status == AuthStatus.initial ||
          authState.status == AuthStatus.loading) {
        return isSplash ? null : '/splash';
      }

      // If we're on splash and NOT loading, we must redirect
      if (isSplash) {
        return isAuth ? '/shell/dashboard' : '/login';
      }

      // Not authenticated — redirect to login (unless already on auth screens)
      if (!isAuth && !isAuthRoute) {
        return '/login';
      }

      // Authenticated — redirect away from auth screens
      if (isAuth && isAuthRoute) {
        return '/shell/dashboard';
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const SignupScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => ShellScreen(child: child),
        routes: [
          GoRoute(
            path: '/shell/dashboard',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: DashboardScreen(),
            ),
          ),
          GoRoute(
            path: '/shell/prospects',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: ProspectsScreen(),
            ),
          ),
          GoRoute(
            path: '/shell/calls',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: CallsScreen(),
            ),
          ),
          GoRoute(
            path: '/shell/insights',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: InsightsScreen(),
            ),
          ),
          GoRoute(
            path: '/shell/profile',
            pageBuilder: (context, state) => const NoTransitionPage(
              child: SettingsScreen(), // Using SettingsScreen as Profile
            ),
          ),
        ],
      ),
    ],
  );
});
