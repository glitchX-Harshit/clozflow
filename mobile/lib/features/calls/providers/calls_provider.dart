import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:clozflow/core/network/api_client.dart';

final callHistoryProvider = FutureProvider<List<dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return await api.get<List<dynamic>>('/calls/');
});

final callDetailsProvider = FutureProvider.family<Map<String, dynamic>, int>((ref, callId) async {
  final api = ref.watch(apiClientProvider);
  return await api.get<Map<String, dynamic>>('/calls/$callId');
});
