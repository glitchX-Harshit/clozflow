import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/features/calls/providers/calls_provider.dart';
import 'package:clozflow/widgets/shimmer_loading.dart';
import 'package:intl/intl.dart';

class CallsScreen extends ConsumerWidget {
  const CallsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final callsAsync = ref.watch(callHistoryProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Call History'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(callHistoryProvider),
        child: callsAsync.when(
          data: (calls) {
            if (calls.isEmpty) {
              return _buildEmptyState();
            }
            return ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: calls.length,
              separatorBuilder: (context, index) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, index) {
                final call = calls[index];
                return _CallHistoryCard(call: call);
              },
            );
          },
          loading: () => const ListShimmer(),
          error: (e, st) => Center(child: Text('Error: $e')),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return ListView(
      children: [
        const SizedBox(height: 100),
        Center(
          child: Container(
            margin: const EdgeInsets.all(AppSpacing.xl),
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.black, width: 4),
              color: Colors.white,
              boxShadow: const [
                BoxShadow(
                  color: Colors.black,
                  offset: Offset(6, 6),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.history, size: 64, color: Colors.black),
                const SizedBox(height: AppSpacing.md),
                Text('NO CALL HISTORY', style: AppTextStyles.h3.copyWith(fontWeight: FontWeight.w900, letterSpacing: 2)),
                const SizedBox(height: AppSpacing.md),
                Container(height: 4, width: 40, color: Colors.black),
                const SizedBox(height: AppSpacing.md),
                Text('YOUR COMPLETED CALLS WILL APPEAR HERE.', style: AppTextStyles.body2.copyWith(color: Colors.black, fontWeight: FontWeight.bold, letterSpacing: 1.5), textAlign: TextAlign.center),
              ],
            ),
          ),
        )
      ],
    );
  }
}

class _CallHistoryCard extends StatelessWidget {
  final dynamic call;

  const _CallHistoryCard({required this.call});

  @override
  Widget build(BuildContext context) {
    final date = DateTime.tryParse(call['timestamp'] ?? '');
    final formattedDate = date != null ? DateFormat('MMM d, yyyy • h:mm a').format(date) : 'Unknown Date';
    final msgCount = call['message_count'] ?? 0;
    final insightCount = call['insight_count'] ?? 0;

    return InkWell(
      onTap: () {
        context.push('/call-details', extra: call['id']);
      },
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: Colors.black, width: 3),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: Colors.black, width: 3)),
                color: Colors.black,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('SALES CALL', style: AppTextStyles.subtitle1.copyWith(color: Colors.white, fontWeight: FontWeight.w900, letterSpacing: 1.5)),
                  const Icon(Icons.chevron_right, color: Colors.white),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(formattedDate.toUpperCase(), style: AppTextStyles.caption.copyWith(color: Colors.black, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                  const SizedBox(height: AppSpacing.md),
                  Row(
                    children: [
                      _buildChip(Icons.forum, '$msgCount MESSAGES'),
                      const SizedBox(width: AppSpacing.sm),
                      _buildChip(Icons.lightbulb, '$insightCount INSIGHTS'),
                    ],
                  )
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: Colors.black, width: 2),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.black),
          const SizedBox(width: 4),
          Text(
            label,
            style: AppTextStyles.caption.copyWith(color: Colors.black, fontWeight: FontWeight.w900, letterSpacing: 1.2),
          ),
        ],
      ),
    );
  }
}
