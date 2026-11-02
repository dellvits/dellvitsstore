import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';
import 'package:provider/provider.dart';

import '../../core/api.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/links.dart';
import '../../core/resource.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../../widgets/common.dart';
import '../auth/login_screen.dart';

/// One article as lists show it.
class BlogSummary {
  BlogSummary.fromJson(Json j)
    : slug = asString(j['slug']),
      title = asString(j['title']),
      excerpt = asString(j['excerpt']),
      cover = asString(j['cover_image']),
      category = asString(j['category']),
      author = asString(j['author_name']),
      publishedAt = asString(j['published_at']),
      minutes = asInt(j['reading_minutes'], 1),
      views = asInt(j['views']);

  final String slug, title, excerpt, cover, category, author, publishedAt;
  final int minutes, views;
}

/// The blog's articles, newest first, with category filters.
class BlogListScreen extends StatefulWidget {
  const BlogListScreen({super.key});

  @override
  State<BlogListScreen> createState() => _BlogListScreenState();
}

class _BlogListScreenState extends State<BlogListScreen> {
  String _category = '';
  late Resource<Json> _list = _load();

  Resource<Json> _load() => Resource<Json>(
    () async => asMap(await Api.instance.get('/blog', query: {'limit': '48', if (_category.isNotEmpty) 'category': _category})),
  )..start();

  @override
  void dispose() {
    _list.dispose();
    super.dispose();
  }

  void _choose(String category) {
    setState(() {
      _category = category;
      _list.dispose();
      _list = _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final title = asString(asMap(context.watch<AppState>().site.blog)['title'], 'Blog');
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: RefreshIndicator(
        color: c.brand,
        onRefresh: () => _list.refresh(silent: true),
        child: ResourceView<Json>(
          resource: _list,
          builder: (context, data) {
            final posts = asList(data['posts']).map(BlogSummary.fromJson).toList();
            final categories = asList(data['categories']).map((x) => asString(asMap(x)['name'])).toList();
            final fallback = asString(asMap(data['settings'])['default_image']);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
                if (asString(asMap(data['settings'])['description']).isNotEmpty) ...[
                  Text(asString(asMap(data['settings'])['description']), style: context.t.bodyMedium),
                  const SizedBox(height: 12),
                ],
                if (categories.isNotEmpty) ...[
                  SizedBox(
                    height: 38,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: [
                        for (final cat in ['', ...categories])
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text(cat.isEmpty ? 'All' : cat),
                              selected: _category == cat,
                              onSelected: (_) => _choose(cat),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                ],
                if (posts.isEmpty)
                  const EmptyState(icon: Icons.article_outlined, title: 'No articles yet', message: 'Check back soon.')
                else
                  for (final p in posts) ...[BlogCard(p, fallback: fallback), const SizedBox(height: 14)],
              ],
            );
          },
        ),
      ),
    );
  }
}

class BlogCard extends StatelessWidget {
  const BlogCard(this.post, {super.key, this.fallback = '', this.compact = false});
  final BlogSummary post;
  final String fallback;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final cover = post.cover.isNotEmpty ? post.cover : fallback;
    return AppCard(
      padding: EdgeInsets.zero,
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => BlogPostScreen(slug: post.slug))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (cover.isNotEmpty) AspectRatio(aspectRatio: 16 / 9, child: NetImage(cover)),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (post.category.isNotEmpty)
                  Text(post.category.toUpperCase(), style: context.t.labelSmall!.copyWith(color: context.c.brand, letterSpacing: 0.6)),
                const SizedBox(height: 4),
                Text(post.title, style: context.t.titleMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
                if (!compact && post.excerpt.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(post.excerpt, style: context.t.bodySmall, maxLines: 3, overflow: TextOverflow.ellipsis),
                ],
                const SizedBox(height: 8),
                Text('${dayText(post.publishedAt)} · ${post.minutes} min read', style: context.t.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One article: the text with its pictures, videos and links, sharing, and comments.
class BlogPostScreen extends StatefulWidget {
  const BlogPostScreen({super.key, required this.slug});
  final String slug;

  @override
  State<BlogPostScreen> createState() => _BlogPostScreenState();
}

class _BlogPostScreenState extends State<BlogPostScreen> {
  late final Resource<Json> _post = Resource<Json>(
    () async => asMap(await Api.instance.get('/blog/${Uri.encodeComponent(widget.slug)}')),
  )..start();
  final _comment = TextEditingController();
  final _name = TextEditingController();
  final List<Json> _added = [];
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    Api.instance.post('/blog/${Uri.encodeComponent(widget.slug)}/view', {}).catchError((_) => null);
  }

  @override
  void dispose() {
    _post.dispose();
    _comment.dispose();
    _name.dispose();
    super.dispose();
  }

  String get _link => AppConfig.url('/blog/${widget.slug}');

  Future<void> _send(AppState app) async {
    final body = _comment.text.trim();
    if (body.length < 2 || _sending) return;
    setState(() => _sending = true);
    try {
      final r = asMap(
        await app.api.post('/blog/${Uri.encodeComponent(widget.slug)}/comments', {'body': body, 'name': _name.text.trim()}),
      );
      _comment.clear();
      if (asString(r['status']) == 'approved') {
        setState(() => _added.add({'id': r['id'], 'name': app.user?.name ?? _name.text.trim(), 'body': body, 'created_at': DateTime.now().toIso8601String()}));
        app.notice('Your comment is published.');
      } else {
        app.notice('Thank you. Your comment will appear once it is approved.');
      }
    } catch (e) {
      app.notice(errorText(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// Videos open in the YouTube, Vimeo or Facebook app, or the browser.
  Widget? _custom(BuildContext context, dynamic element) {
    final tag = element.localName as String?;
    if (tag != 'iframe' && tag != 'video') return null;
    var src = AppConfig.url(asString(element.attributes['src']));
    final yt = RegExp(r'youtube\.com/embed/([\w-]+)').firstMatch(src);
    if (yt != null) src = 'https://www.youtube.com/watch?v=${yt.group(1)}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: AppCard(
        onTap: () => openExternal(src),
        color: context.c.soft,
        child: Row(
          children: [
            Icon(Icons.play_circle_fill_rounded, color: context.c.brand, size: 36),
            const SizedBox(width: 12),
            const Expanded(child: Text('Watch the video')),
            const Icon(Icons.open_in_new_rounded, size: 18),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.c;
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(
            tooltip: 'Copy link',
            icon: const Icon(Icons.link_rounded),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: _link));
              app.notice('Link copied. Paste it into a post, a story or a chat.');
            },
          ),
        ],
      ),
      body: ResourceView<Json>(
        resource: _post,
        builder: (context, p) {
          final post = BlogSummary.fromJson(p);
          final settings = asMap(p['settings']);
          final cover = post.cover.isNotEmpty ? post.cover : asString(settings['default_image']);
          final comments = [...asList(p['comments']).map(asMap), ..._added];
          final open = asBool(p['comments_open']);
          final guests = asBool(settings['comments_guests']);
          final related = asList(p['related']).map((x) => BlogSummary.fromJson(asMap(x))).toList();
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              if (post.category.isNotEmpty)
                Text(post.category.toUpperCase(), style: context.t.labelSmall!.copyWith(color: c.brand, letterSpacing: 0.6)),
              const SizedBox(height: 4),
              Text(post.title, style: context.t.headlineSmall!.copyWith(fontWeight: FontWeight.w800, color: c.ink)),
              const SizedBox(height: 8),
              Text(
                [if (post.author.isNotEmpty) post.author, dayText(post.publishedAt), '${post.minutes} min read'].join(' · '),
                style: context.t.bodySmall,
              ),
              const SizedBox(height: 14),
              if (cover.isNotEmpty) ...[
                ClipRRect(borderRadius: BorderRadius.circular(16), child: AspectRatio(aspectRatio: 16 / 9, child: NetImage(cover))),
                const SizedBox(height: 16),
              ],
              HtmlWidget(
                asString(p['content']),
                baseUrl: Uri.parse(AppConfig.origin),
                textStyle: context.t.bodyLarge!.copyWith(height: 1.6, color: c.text),
                customWidgetBuilder: (element) => _custom(context, element),
                onTapUrl: (url) => openExternal(url),
              ),
              if (asBool(settings['share_buttons'], true)) ...[
                const SizedBox(height: 18),
                Text('Share this article', style: context.t.titleSmall),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _ShareButton(
                      'Facebook',
                      const Color(0xFF1877F2),
                      () => openExternal('https://www.facebook.com/sharer/sharer.php?u=${Uri.encodeComponent(_link)}'),
                    ),
                    _ShareButton(
                      'WhatsApp',
                      const Color(0xFF25D366),
                      () => openExternal('https://wa.me/?text=${Uri.encodeComponent('${post.title} $_link')}'),
                    ),
                    _ShareButton('Instagram', const Color(0xFFDC2743), () {
                      // Instagram takes no links to share: copy it for a story or the bio, then open the app.
                      Clipboard.setData(ClipboardData(text: _link));
                      app.notice('Link copied. Paste it into your Instagram story or post.');
                      openExternal('https://www.instagram.com/');
                    }),
                  ],
                ),
              ],
              if (open || comments.isNotEmpty) ...[
                const SizedBox(height: 24),
                Text('${comments.length} comment${comments.length == 1 ? '' : 's'}', style: context.t.titleMedium),
                const SizedBox(height: 8),
                for (final m in comments)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Avatar(asString(m['name']), size: 34),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${asString(m['name'])} · ${dayText(asString(m['created_at']))}', style: context.t.bodySmall),
                              Text(asString(m['body'])),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                if (open)
                  if (app.user == null && !guests)
                    AppButton(
                      'Sign in to comment',
                      outlined: true,
                      onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
                    )
                  else ...[
                    if (app.user == null) ...[
                      TextField(controller: _name, maxLength: 80, decoration: const InputDecoration(labelText: 'Your name', counterText: '')),
                      const SizedBox(height: 8),
                    ],
                    TextField(
                      controller: _comment,
                      minLines: 2,
                      maxLines: 5,
                      maxLength: 2000,
                      decoration: const InputDecoration(labelText: 'Write a comment', counterText: ''),
                    ),
                    const SizedBox(height: 8),
                    AppButton('Post comment', icon: Icons.send_rounded, busy: _sending, onPressed: () => _send(app)),
                  ],
              ],
              if (related.isNotEmpty) ...[
                const SizedBox(height: 26),
                Text('Keep reading', style: context.t.titleMedium),
                const SizedBox(height: 10),
                for (final r in related) ...[
                  BlogCard(r, fallback: asString(settings['default_image']), compact: true),
                  const SizedBox(height: 12),
                ],
              ],
            ],
          );
        },
      ),
    );
  }
}

class _ShareButton extends StatelessWidget {
  const _ShareButton(this.label, this.color, this.onTap);
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => FilledButton(
    style: FilledButton.styleFrom(backgroundColor: color, foregroundColor: Colors.white),
    onPressed: onTap,
    child: Text(label),
  );
}

/// The latest articles, for the home screen.
class BlogHomeSection extends StatefulWidget {
  const BlogHomeSection({super.key, required this.count});
  final int count;

  @override
  State<BlogHomeSection> createState() => _BlogHomeSectionState();
}

class _BlogHomeSectionState extends State<BlogHomeSection> {
  late final Resource<Json> _list = Resource<Json>(
    () async => asMap(await Api.instance.get('/blog', query: {'limit': '${widget.count}'})),
  )..start();

  @override
  void dispose() {
    _list.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _list,
    builder: (context, _) {
      final posts = asList(_list.data?['posts']).map((x) => BlogSummary.fromJson(asMap(x))).toList();
      if (posts.isEmpty) return const SizedBox.shrink();
      final fallback = asString(asMap(_list.data?['settings'])['default_image']);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(
            'Fresh from the blog',
            eyebrow: 'Blog',
            action: 'All articles',
            onAction: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BlogListScreen())),
          ),
          SizedBox(
            height: 270,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: posts.length,
              separatorBuilder: (_, _) => const SizedBox(width: 12),
              itemBuilder: (context, i) => SizedBox(width: 260, child: BlogCard(posts[i], fallback: fallback, compact: true)),
            ),
          ),
        ],
      );
    },
  );
}
