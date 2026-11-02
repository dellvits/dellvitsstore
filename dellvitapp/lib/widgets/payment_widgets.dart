import 'dart:io';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/pick_image.dart';
import '../core/theme.dart';
import '../models/models.dart';
import 'common.dart';

/// The bank or wallet account a customer pays into, each value with a copy button.
class AccountDetails extends StatelessWidget {
  const AccountDetails(this.method, {super.key});
  final PaymentMethod method;

  @override
  Widget build(BuildContext context) {
    final details = method.details;
    if (details.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 6, 4, 6),
      decoration: BoxDecoration(
        color: context.c.soft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(children: [for (final d in details) CopyRow(d.key, d.value)]),
    );
  }
}

/// What a customer enters after paying online: the transaction ID, who paid, and a receipt.
class ProofData {
  ProofData({String payerName = '', String payerAccount = ''})
    : payerName = TextEditingController(text: payerName),
      payerAccount = TextEditingController(text: payerAccount);

  final transactionId = TextEditingController();
  final TextEditingController payerName, payerAccount;
  String? proofId;
  String? proofPath;

  Json toJson() => {
    'transaction_id': transactionId.text.trim(),
    'payer_name': payerName.text.trim(),
    'payer_account': payerAccount.text.trim(),
    'proof_id': ?proofId,
  };

  void dispose() {
    transactionId.dispose();
    payerName.dispose();
    payerAccount.dispose();
  }
}

class ProofFields extends StatefulWidget {
  const ProofFields({super.key, required this.data, this.requireProof = false});
  final ProofData data;
  final bool requireProof;

  @override
  State<ProofFields> createState() => _ProofFieldsState();
}

class _ProofFieldsState extends State<ProofFields> {
  bool _busy = false;
  String? _error;

  Future<void> _pick() async {
    final picked = await pickAndCropImage(context, title: 'Crop receipt');
    if (picked == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asMap(await Api.instance.upload('/payment-proofs', picked));
      widget.data.proofId = asString(r['id']);
      widget.data.proofPath = picked;
    } catch (e) {
      _error = errorText(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final d = widget.data;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextFormField(
          controller: d.transactionId,
          maxLength: 60,
          decoration: const InputDecoration(labelText: 'Transaction ID (TID)', hintText: 'e.g. 0123456789', counterText: ''),
          validator: (v) => (v ?? '').trim().length < 4 ? 'Enter the transaction ID from your receipt.' : null,
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: d.payerName,
          maxLength: 100,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: 'Sender account name', counterText: ''),
          validator: (v) => (v ?? '').trim().isEmpty ? 'Enter the name on the account you paid from.' : null,
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: d.payerAccount,
          maxLength: 40,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: 'Sender number / account (optional)', hintText: '03XX XXXXXXX', counterText: ''),
        ),
        const SizedBox(height: 12),
        Material(
          color: c.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(color: _error != null ? c.brand : c.lineStrong),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: _busy ? null : _pick,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  if (d.proofPath != null)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.file(File(d.proofPath!), width: 52, height: 52, fit: BoxFit.cover),
                    )
                  else
                    IconBubble(Icons.add_photo_alternate_outlined, size: 52, tone: Tone.brand),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _busy
                              ? 'Uploading…'
                              : d.proofPath != null
                              ? 'Receipt attached'
                              : 'Upload receipt screenshot',
                          style: context.t.titleSmall,
                        ),
                        Text(
                          d.proofPath != null
                              ? 'Tap to replace it'
                              : widget.requireProof
                              ? 'Required for this payment method'
                              : 'Optional, but it speeds up verification',
                          style: context.t.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  if (_busy)
                    const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2))
                  else if (d.proofPath != null)
                    Icon(Icons.check_circle_rounded, color: c.green),
                ],
              ),
            ),
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 4),
            child: Text(_error!, style: TextStyle(color: c.brand, fontSize: 12, fontWeight: FontWeight.w600)),
          ),
      ],
    );
  }
}
