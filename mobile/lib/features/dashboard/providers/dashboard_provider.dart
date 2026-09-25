import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:clozflow/core/network/api_client.dart';

final dashboardStatsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return await api.get<Map<String, dynamic>>('/calls/stats');
});

final recentCallsProvider = FutureProvider<List<dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return await api.get<List<dynamic>>('/calls/');
});


