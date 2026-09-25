import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class AuthInterceptor extends Interceptor {
  final SupabaseClient supabaseClient;

  AuthInterceptor(this.supabaseClient);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final session = supabaseClient.auth.currentSession;
    if (session != null && session.accessToken.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer ${session.accessToken}';
    }
    super.onRequest(options, handler);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      try {
        final session = supabaseClient.auth.currentSession;
        if (session != null && session.isExpired) {
          // Attempt to refresh the session
          final response = await supabaseClient.auth.refreshSession();
          final newSession = response.session;
          
          if (newSession != null && newSession.accessToken.isNotEmpty) {
            // Retry the request with the new token
            final options = err.requestOptions;
            options.headers['Authorization'] = 'Bearer ${newSession.accessToken}';
            
            // Create a new Dio instance to avoid interceptor loop
            final dio = Dio();
            final retryResponse = await dio.fetch(options);
            return handler.resolve(retryResponse);
          }
        }
      } catch (e) {
        // Refresh failed, user needs to re-authenticate
        await supabaseClient.auth.signOut();
      }
    }
    super.onError(err, handler);
  }
}
