import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout, colors } from '../app/styles';

type Template = {
  id: string;
  title: string;
  body: string;
  assetId: string | null;
};

type AssetOption = {
  id: string;
  name: string;
  platform: 'facebook' | 'instagram';
};

const pageStyles = stylex.create({
  grid: {
    display: 'grid',
    gap: '16px',
  },
  form: {
    display: 'grid',
    gap: '10px',
  },
  textArea: {
    width: '100%',
    minHeight: '120px',
    borderRadius: '12px',
    border: '1px solid rgba(12, 27, 26, 0.15)',
    padding: '10px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  templateCard: {
    borderRadius: '14px',
    border: '1px solid rgba(12, 27, 26, 0.1)',
    padding: '12px',
    backgroundColor: '#ffffff',
    display: 'grid',
    gap: '6px',
  },
});

export default function InboxTemplates(): React.ReactElement {
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [assets, setAssets] = React.useState<AssetOption[]>([]);
  const [flags, setFlags] = React.useState<{ followupInbox?: boolean } | null>(
    null,
  );
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [assetId, setAssetId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const loadFlags = React.useCallback(async () => {
    try {
      const response = await fetch('/api/feature-flags');
      if (!response.ok) return;
      const data = (await response.json()) as { followupInbox?: boolean };
      setFlags(data ?? null);
    } catch {
      setFlags(null);
    }
  }, []);

  const loadTemplates = React.useCallback(async () => {
    const response = await fetch('/api/inbox/templates');
    if (!response.ok) return;
    const data = (await response.json()) as { templates: Template[] };
    setTemplates(data.templates ?? []);
  }, []);

  const loadAssets = React.useCallback(async () => {
    const response = await fetch('/api/assets');
    if (!response.ok) return;
    const data = (await response.json()) as {
      pages: Array<{ id: string; name: string }>;
      igAssets: Array<{ id: string; name: string }>;
    };
    const next: AssetOption[] = [];
    for (const page of data.pages ?? []) {
      next.push({ id: page.id, name: page.name, platform: 'facebook' });
    }
    for (const ig of data.igAssets ?? []) {
      next.push({ id: ig.id, name: ig.name, platform: 'instagram' });
    }
    setAssets(next);
  }, []);

  React.useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  React.useEffect(() => {
    if (!flags?.followupInbox) return;
    void loadAssets();
    void loadTemplates();
  }, [flags?.followupInbox, loadAssets, loadTemplates]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setBody('');
    setAssetId('');
  };

  const handleSubmit = async () => {
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.');
      return;
    }
    const payload = {
      title: title.trim(),
      body: body.trim(),
      assetId: assetId || null,
    };
    const response = await fetch(
      editingId ? `/api/inbox/templates/${editingId}` : '/api/inbox/templates',
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      setError('Failed to save template.');
      return;
    }
    resetForm();
    await loadTemplates();
  };

  const handleEdit = (template: Template) => {
    setEditingId(template.id);
    setTitle(template.title);
    setBody(template.body);
    setAssetId(template.assetId ?? '');
  };

  const handleDelete = async (templateId: string) => {
    if (!window.confirm('Delete this template?')) return;
    const response = await fetch(`/api/inbox/templates/${templateId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      setError('Failed to delete template.');
      return;
    }
    await loadTemplates();
  };

  if (flags && !flags.followupInbox) {
    return (
      <section {...stylex.props(layout.card)}>
        <h2>Saved responses</h2>
        <p {...stylex.props(layout.note)}>
          This feature is currently disabled.
        </p>
      </section>
    );
  }

  return (
    <div {...stylex.props(pageStyles.grid)}>
      <section {...stylex.props(layout.card)}>
        <h2>Saved responses</h2>
        <p {...stylex.props(layout.note)}>
          Manage text-only templates for Messenger and Instagram replies.
        </p>
        {error ? <p style={{ color: colors.coral }}>{error}</p> : null}
        <div {...stylex.props(pageStyles.form)}>
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              style={{ marginLeft: '8px', width: '60%' }}
            />
          </label>
          <label>
            Asset
            <select
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              style={{ marginLeft: '8px' }}
            >
              <option value="">Global (all assets)</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Body
            <textarea
              {...stylex.props(pageStyles.textArea)}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button {...stylex.props(layout.button)} onClick={handleSubmit}>
              {editingId ? 'Update template' : 'Save template'}
            </button>
            {editingId ? (
              <button {...stylex.props(layout.ghostButton)} onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section {...stylex.props(layout.card)}>
        <h3>Existing templates</h3>
        <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
          {templates.map((template) => (
            <div key={template.id} {...stylex.props(pageStyles.templateCard)}>
              <strong>{template.title}</strong>
              <div style={{ color: colors.slate, fontSize: '13px' }}>
                {template.assetId
                  ? assets.find((asset) => asset.id === template.assetId)?.name
                  : 'Global'}
              </div>
              <div>{template.body}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  {...stylex.props(layout.ghostButton)}
                  onClick={() => handleEdit(template)}
                >
                  Edit
                </button>
                <button
                  {...stylex.props(layout.ghostButton)}
                  onClick={() => handleDelete(template.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
