import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:clozflow/core/theme/app_text_styles.dart';

class ProspectsScreen extends ConsumerWidget {
  const ProspectsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Prospects'),
      ),
      body: Center(
        child: Text(
          'Prospects — Coming in Phase 2',
          style: AppTextStyles.body1,
        ),
      ),
    );
  }
}
