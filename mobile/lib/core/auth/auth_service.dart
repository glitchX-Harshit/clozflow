import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService(Supabase.instance.client);
});

class AuthService {
  final SupabaseClient _supabaseClient;

  AuthService(this._supabaseClient);

  Future<AuthResponse> signInWithEmail(String email, String password) async {
    try {
      return await _supabaseClient.auth.signInWithPassword(
        email: email,
        password: password,
      );
    } catch (e) {
      rethrow;
    }
  }

  Future<AuthResponse> signUpWithEmail(String email, String password, String fullName) async {
    try {
      return await _supabaseClient.auth.signUp(
        email: email,
        password: password,
        data: {'full_name': fullName},
      );
    } catch (e) {
      rethrow;
    }
  }

  Future<bool> signInWithGoogle() async {
    try {
      return await _supabaseClient.auth.signInWithOAuth(
        OAuthProvider.google,
        redirectTo: 'com.clozflow.mobile://login-callback/',
      );
    } catch (e) {
      rethrow;
    }
  }

  Future<bool> signInWithGithub() async {
    try {
      return await _supabaseClient.auth.signInWithOAuth(
        OAuthProvider.github,
        redirectTo: 'com.clozflow.mobile://login-callback/',
      );
    } catch (e) {
      rethrow;
    }
  }

  Future<void> signOut() async {
    try {
      await _supabaseClient.auth.signOut();
    } catch (e) {
      rethrow;
    }
  }

  Session? getCurrentSession() {
    return _supabaseClient.auth.currentSession;
  }

  User? getCurrentUser() {
    return _supabaseClient.auth.currentUser;
  }

  Future<AuthResponse> refreshSession() async {
    try {
      return await _supabaseClient.auth.refreshSession();
    } catch (e) {
      rethrow;
    }
  }

  Stream<AuthState> get onAuthStateChange => _supabaseClient.auth.onAuthStateChange;
}
