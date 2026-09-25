import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:clozflow/core/theme/app_colors.dart';

class ShellScreen extends ConsumerWidget {
  final Widget child;

  const ShellScreen({
    super.key,
    required this.child,
  });

  int _calculateSelectedIndex(BuildContext context) {
    final String location = GoRouterState.of(context).uri.path;
    if (location.startsWith('/shell/dashboard')) return 0;
    if (location.startsWith('/shell/prospects')) return 1;
    if (location.startsWith('/shell/calls')) return 2;
    if (location.startsWith('/shell/insights')) return 3;
    if (location.startsWith('/shell/profile')) return 4;
    return 0;
  }

  void _onItemTapped(int index, BuildContext context) {
    switch (index) {
      case 0:
        context.go('/shell/dashboard');
        break;
      case 1:
        context.go('/shell/prospects');
        break;
      case 2:
        context.go('/shell/calls');
        break;
      case 3:
        context.go('/shell/insights');
        break;
      case 4:
        context.go('/shell/profile');
        break;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: child,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: Colors.black, width: 4)),
        ),
        child: BottomNavigationBar(
          currentIndex: _calculateSelectedIndex(context),
          onTap: (index) => _onItemTapped(index, context),
          type: BottomNavigationBarType.fixed,
          backgroundColor: Colors.white,
          selectedItemColor: Colors.black,
          unselectedItemColor: Colors.black54,
          selectedLabelStyle: const TextStyle(fontWeight: FontWeight.w900, letterSpacing: 1),
          unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold),
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.home_rounded),
              label: 'HOME',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.people_rounded),
              label: 'PROSPECTS',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.phone_rounded),
              label: 'CALLS',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.insights_rounded),
              label: 'INSIGHTS',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.person_rounded),
              label: 'PROFILE',
            ),
          ],
        ),
      ),
    );
  }
}
