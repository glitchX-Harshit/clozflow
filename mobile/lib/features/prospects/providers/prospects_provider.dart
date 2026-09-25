import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'package:clozflow/core/network/api_client.dart';

final savedLeadsProvider = FutureProvider<List<dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return await api.get<List<dynamic>>('/leads/saved');
});

final searchLeadsProvider = FutureProvider.family<List<dynamic>, String>((ref, query) async {
  if (query.isEmpty) return [];
  final api = ref.watch(apiClientProvider);
  return await api.post<List<dynamic>>(
    '/leads/search',
    data: {
      'query': query,
      'filters': {},
      'user_offer': 'Software solutions',
      'search_mode': 'high_fit_leads'
    },
    options: Options(
      receiveTimeout: const Duration(minutes: 5),
    ),
  );
});
