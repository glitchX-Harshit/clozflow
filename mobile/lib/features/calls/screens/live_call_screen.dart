import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/features/calls/providers/live_call_provider.dart';

class LiveCallScreen extends ConsumerStatefulWidget {
  final dynamic lead;

  const LiveCallScreen({super.key, required this.lead});

  @override
  ConsumerState<LiveCallScreen> createState() => _LiveCallScreenState();
}

class _LiveCallScreenState extends ConsumerState<LiveCallScreen> {
  late ScrollController _transcriptScrollController;

  @override
  void initState() {
    super.initState();
    _transcriptScrollController = ScrollController();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Start the call automatically when screen opens
      // Using lead ID or a new context ID. We'll use lead ID as string for now.
      final contextId = widget.lead['id']?.toString() ?? 'unknown_${DateTime.now().millisecondsSinceEpoch}';
      ref.read(liveCallProvider.notifier).startCall(contextId);
    });
  }

  @override
  void dispose() {
    _transcriptScrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    if (_transcriptScrollController.hasClients) {
      _transcriptScrollController.animateTo(
        _transcriptScrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  String _formatDuration(Duration d) {
    String twoDigits(int n) => n.toString().padLeft(2, '0');
    final minutes = twoDigits(d.inMinutes.remainder(60));
    final seconds = twoDigits(d.inSeconds.remainder(60));
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    final callState = ref.watch(liveCallProvider);
    final businessName = widget.lead['business_name'] ?? 'Unknown Prospect';

    ref.listen<CallState>(liveCallProvider, (previous, next) {
      if (previous?.transcripts.length != next.transcripts.length) {
        Future.delayed(const Duration(milliseconds: 100), _scrollToBottom);
      }
    });

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        title: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(businessName, style: AppTextStyles.subtitle1),
                Text(
                  callState.status == CallStatus.connected
                      ? 'Live • ${_formatDuration(callState.duration)}'
                      : callState.status.name.toUpperCase(),
                  style: AppTextStyles.caption.copyWith(
                    color: callState.status == CallStatus.connected ? AppColors.error : AppColors.textSecondary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            if (callState.status == CallStatus.connected)
              const Icon(Icons.graphic_eq, color: AppColors.error),
          ],
        ),
      ),
      body: Column(
        children: [
          // Top section: Insights Stack
          if (callState.aiInsights.isNotEmpty)
            Container(
              constraints: const BoxConstraints(maxHeight: 250),
              child: ListView.builder(
                padding: const EdgeInsets.all(AppSpacing.md),
                scrollDirection: Axis.horizontal,
                itemCount: callState.aiInsights.length,
                itemBuilder: (context, index) {
                  final insight = callState.aiInsights[index];
                  final confidence = (insight['confidence'] as num?)?.toDouble() ?? 0.0;
                  final color = confidence > 0.7 ? AppColors.success : (confidence > 0.4 ? AppColors.warning : AppColors.error);
                  return _buildInsightCard(insight, color);
                },
              ),
            )
          else
            Container(
              height: 120,
              alignment: Alignment.center,
              child: Text(
                'AI is listening...',
                style: AppTextStyles.body2.copyWith(color: AppColors.textTertiary),
              ),
            ),
            
          const Divider(height: 1),

          // Bottom section: Live Transcript
          Expanded(
            child: Container(
              color: Colors.white,
              child: ListView.builder(
                controller: _transcriptScrollController,
                padding: const EdgeInsets.all(AppSpacing.md),
                itemCount: callState.transcripts.length,
                itemBuilder: (context, index) {
                  final t = callState.transcripts[index];
                  final isAgent = t['speaker'] == 'agent';
                  return Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: isAgent ? MainAxisAlignment.end : MainAxisAlignment.start,
                      children: [
                        if (!isAgent)
                          const CircleAvatar(
                            radius: 12,
                            backgroundColor: AppColors.navy,
                            child: Icon(Icons.person, size: 14, color: Colors.white),
                          ),
                        const SizedBox(width: AppSpacing.xs),
                        Flexible(
                          child: Container(
                            padding: const EdgeInsets.all(AppSpacing.sm),
                            decoration: BoxDecoration(
                              color: isAgent ? AppColors.lightBlue : AppColors.background,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              t['text'] ?? '',
                              style: AppTextStyles.body1,
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.xs),
                        if (isAgent)
                          const CircleAvatar(
                            radius: 12,
                            backgroundColor: AppColors.success,
                            child: Icon(Icons.support_agent, size: 14, color: Colors.white),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(32)),
            ),
            icon: const Icon(Icons.call_end),
            label: const Text('End Call', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            onPressed: () async {
              await ref.read(liveCallProvider.notifier).endCall();
              if (context.mounted) {
                context.pop();
              }
            },
          ),
        ),
      ),
    );
  }

  Widget _buildInsightCard(Map<String, dynamic> insight, Color statusColor) {
    return Container(
      width: 280,
      margin: const EdgeInsets.only(right: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.divider),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.auto_awesome, color: statusColor, size: 18),
              const SizedBox(width: 8),
              Text(
                insight['strategy'] ?? 'Strategy',
                style: AppTextStyles.subtitle2.copyWith(color: statusColor),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            insight['coaching_tip'] ?? insight['suggested_response'] ?? 'No tip available.',
            style: AppTextStyles.body1.copyWith(fontWeight: FontWeight.w600),
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
          ),
          const Spacer(),
          if (insight['hidden_concern'] != null)
            Text(
              'Concern: ${insight['hidden_concern']}',
              style: AppTextStyles.caption.copyWith(color: AppColors.textSecondary),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
    );
  }
}
