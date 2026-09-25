import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:clozflow/core/network/api_client.dart';

final capsulesProvider = FutureProvider<List<dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return await api.get<List<dynamic>>('/api/capsules');
});
