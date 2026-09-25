import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:clozflow/core/config/env_config.dart';

enum CallStatus { connecting, connected, disconnected, error }

class CallState {
  final CallStatus status;
  final Duration duration;
  final List<Map<String, dynamic>> transcripts;
  final List<Map<String, dynamic>> aiInsights;

  CallState({
    required this.status,
    required this.duration,
    required this.transcripts,
    required this.aiInsights,
  });

  CallState copyWith({
    CallStatus? status,
    Duration? duration,
    List<Map<String, dynamic>>? transcripts,
    List<Map<String, dynamic>>? aiInsights,
  }) {
    return CallState(
      status: status ?? this.status,
      duration: duration ?? this.duration,
      transcripts: transcripts ?? this.transcripts,
      aiInsights: aiInsights ?? this.aiInsights,
    );
  }
}

class LiveCallNotifier extends StateNotifier<CallState> {
  LiveCallNotifier()
      : super(CallState(
          status: CallStatus.connecting,
          duration: Duration.zero,
          transcripts: [],
          aiInsights: [],
        ));

  WebSocketChannel? _channel;
  final _audioRecorder = AudioRecorder();
  Timer? _timer;
  StreamSubscription? _audioSubscription;
  StreamSubscription? _wsSubscription;

  Future<void> startCall(String contextId) async {
    // 1. Connect WebSocket
    final wsUrl = Uri.parse('${EnvConfig.wsBaseUrl}/ws/audio?context_id=$contextId');
    try {
      _channel = WebSocketChannel.connect(wsUrl);
      
      _wsSubscription = _channel!.stream.listen(
        (message) {
          if (message is String) {
            try {
              final data = jsonDecode(message);
              _handleWebSocketMessage(data);
            } catch (e) {
              print('JSON Decode Error: $e');
            }
          }
        },
        onDone: () => _endCallInternal(),
        onError: (e) {
          state = state.copyWith(status: CallStatus.error);
        },
      );

      state = state.copyWith(status: CallStatus.connected);
      
      // 2. Start Timer
      _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
        state = state.copyWith(duration: Duration(seconds: timer.tick));
      });

      // 3. Start Recording
      if (await _audioRecorder.hasPermission()) {
        final stream = await _audioRecorder.startStream(
          const RecordConfig(
            encoder: AudioEncoder.pcm16bits,
            sampleRate: 16000,
            numChannels: 1,
          ),
        );

        _audioSubscription = stream.listen((Uint8List data) {
          if (_channel != null && state.status == CallStatus.connected) {
            _channel!.sink.add(data); // Send raw binary PCM audio bytes
          }
        });
      }
    } catch (e) {
      state = state.copyWith(status: CallStatus.error);
    }
  }

  void _handleWebSocketMessage(Map<String, dynamic> data) {
    if (data['type'] == 'transcriptUpdate') {
      final text = data['text'] as String?;
      final speaker = data['speaker'] as String? ?? 'prospect';
      if (text != null && text.isNotEmpty) {
        state = state.copyWith(
          transcripts: [
            ...state.transcripts,
            {'speaker': speaker, 'text': text}
          ],
        );
      }
    } else if (data['type'] == 'aiAnalysis') {
      final payload = data['payload'] as Map<String, dynamic>?;
      if (payload != null) {
        state = state.copyWith(
          aiInsights: [
            payload,
            ...state.aiInsights, // put newest at top
          ],
        );
      }
    }
  }

  Future<void> endCall() async {
    if (_channel != null) {
      // Send close stream command as text just in case backend expects it
      _channel!.sink.add(jsonEncode({"text": "close_stream"}));
    }
    await _endCallInternal();
  }

  Future<void> _endCallInternal() async {
    _timer?.cancel();
    await _audioSubscription?.cancel();
    await _audioRecorder.stop();
    await _wsSubscription?.cancel();
    await _channel?.sink.close();
    if (mounted) {
      state = state.copyWith(status: CallStatus.disconnected);
    }
  }

  @override
  void dispose() {
    _endCallInternal();
    _audioRecorder.dispose();
    super.dispose();
  }
}

final liveCallProvider = StateNotifierProvider.autoDispose<LiveCallNotifier, CallState>((ref) {
  return LiveCallNotifier();
});
