import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:clozflow/core/theme/app_colors.dart';
import 'package:clozflow/core/theme/app_spacing.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';
import 'package:clozflow/features/prospects/providers/prospects_provider.dart';
import 'package:clozflow/widgets/shimmer_loading.dart';

class ProspectsScreen extends ConsumerStatefulWidget {
  const ProspectsScreen({super.key});

  @override
  ConsumerState<ProspectsScreen> createState() => _ProspectsScreenState();
}

class _ProspectsScreenState extends ConsumerState<ProspectsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Prospects'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Saved Leads'),
            Tab(text: 'Find Leads'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildSavedLeads(),
          _buildSearchLeads(),
        ],
      ),
    );
  }

  Widget _buildSavedLeads() {
    final asyncLeads = ref.watch(savedLeadsProvider);

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(savedLeadsProvider),
      child: asyncLeads.when(
        data: (leads) {
          if (leads.isEmpty) {
            return _buildEmptyState('No saved leads', 'Search and save leads to see them here.');
          }
          return ListView.separated(
            padding: const EdgeInsets.all(AppSpacing.md),
            itemCount: leads.length,
            separatorBuilder: (context, index) => const Divider(),
            itemBuilder: (context, index) => _LeadCard(lead: leads[index]),
          );
        },
        loading: () => const ListShimmer(),
        error: (e, st) => Center(child: Text('ERROR: $e', style: AppTextStyles.subtitle1.copyWith(color: Colors.red, fontWeight: FontWeight.w900))),
      ),
    );
  }

  Widget _buildSearchLeads() {
    final asyncSearch = _searchQuery.isEmpty ? null : ref.watch(searchLeadsProvider(_searchQuery));

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: 'e.g. Roofers in Austin, TX',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                icon: const Icon(Icons.arrow_forward),
                onPressed: () {
                  setState(() {
                    _searchQuery = _searchController.text;
                  });
                },
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            onSubmitted: (value) {
              setState(() {
                _searchQuery = value;
              });
            },
          ),
        ),
        Expanded(
          child: asyncSearch == null
              ? _buildEmptyState('Find new business', 'Type a query above to find high-fit leads.')
              : asyncSearch.when(
                  data: (results) {
                    if (results.isEmpty) {
                      return _buildEmptyState('No results', 'Try a different search query.');
                    }
                    return ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      itemCount: results.length,
                      separatorBuilder: (context, index) => const Divider(),
                      itemBuilder: (context, index) => _LeadCard(lead: results[index]),
                    );
                  },
                  loading: () => const _QuotesLoader(),
                  error: (e, st) => Center(child: Text('ERROR: $e', style: AppTextStyles.subtitle1.copyWith(color: Colors.red, fontWeight: FontWeight.w900))),
                ),
        ),
      ],
    );
  }

  Widget _buildEmptyState(String title, String subtitle) {
    return Center(
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
            const Icon(Icons.people_outline, size: 64, color: Colors.black),
            const SizedBox(height: AppSpacing.md),
            Text(
              title.toUpperCase(),
              style: AppTextStyles.h3.copyWith(fontWeight: FontWeight.w900, letterSpacing: 2),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.md),
            Container(
              height: 4,
              width: 40,
              color: Colors.black,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              subtitle.toUpperCase(),
              style: AppTextStyles.body2.copyWith(color: Colors.black, fontWeight: FontWeight.bold, letterSpacing: 1.5),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _LeadCard extends StatelessWidget {
  final dynamic lead;

  const _LeadCard({required this.lead});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        context.push('/lead-details', extra: lead);
      },
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
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
                children: [
                  Expanded(
                    child: Text(
                      (lead['business_name'] ?? 'UNKNOWN BUSINESS').toUpperCase(),
                      style: AppTextStyles.subtitle1.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ),
                  if (lead['lead_score'] != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: Colors.black, width: 2),
                      ),
                      child: Text(
                        'FIT: ${lead['lead_score']}',
                        style: AppTextStyles.caption.copyWith(
                          color: Colors.black,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.location_on, size: 16, color: Colors.black),
                      const SizedBox(width: 4),
                      Text(
                        (lead['city'] ?? 'UNKNOWN LOCATION').toUpperCase(),
                        style: AppTextStyles.body2.copyWith(color: Colors.black, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(width: 12),
                      const Icon(Icons.category, size: 16, color: Colors.black),
                      const SizedBox(width: 4),
                      Text(
                        (lead['category'] ?? 'CATEGORY').toUpperCase(),
                        style: AppTextStyles.body2.copyWith(color: Colors.black, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  if (lead['likely_pain_point'] != null && lead['likely_pain_point'].toString().isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.sm),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.black, width: 2),
                        color: const Color(0xFFF0F0F0),
                      ),
                      child: Text(
                        'PAIN POINT: ${lead['likely_pain_point']}'.toUpperCase(),
                        style: AppTextStyles.caption.copyWith(
                          color: Colors.black,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 1.2,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ]
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
class _QuotesLoader extends StatefulWidget {
  const _QuotesLoader({super.key});

  @override
  State<_QuotesLoader> createState() => _QuotesLoaderState();
}

class _QuotesLoaderState extends State<_QuotesLoader> {
  final List<String> _quotes = [
    "“EVERY SALE HAS FIVE BASIC OBSTACLES: NO NEED, NO MONEY, NO HURRY, NO DESIRE, NO TRUST.”",
    "“TIMID SALESMEN HAVE SKINNY KIDS.”",
    "“SUCCESS IS WALKING FROM FAILURE TO FAILURE WITH NO LOSS OF ENTHUSIASM.”",
    "“INNOVATION DISTINGUISHES BETWEEN A LEADER AND A FOLLOWER.”",
    "“OPPORTUNITIES DON'T HAPPEN. YOU CREATE THEM.”",
  ];
  int _index = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 3), (timer) {
      if (mounted) {
        setState(() {
          _index = (_index + 1) % _quotes.length;
        });
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Center(
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
            const CircularProgressIndicator(color: Colors.black, strokeWidth: 4),
            const SizedBox(height: AppSpacing.xl),
            Text(
              'SCANNING REGISTRIES...',
              style: AppTextStyles.h3.copyWith(fontWeight: FontWeight.w900, letterSpacing: 2),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.md),
            Container(height: 4, width: 40, color: Colors.black),
            const SizedBox(height: AppSpacing.md),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 500),
              child: Text(
                _quotes[_index],
                key: ValueKey(_index),
                style: AppTextStyles.body2.copyWith(color: Colors.black, fontWeight: FontWeight.bold, letterSpacing: 1.2),
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
