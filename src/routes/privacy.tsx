import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

export const meta = () => [{ title: 'Privacy Policy | MsgStats' }];

const contentStyles = stylex.create({
  heading: {
    marginTop: '0',
    marginBottom: '8px',
  },
  paragraph: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '15px',
    lineHeight: '1.6',
    color: '#0c1b1a',
    margin: '12px 0',
  },
  list: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '15px',
    lineHeight: '1.6',
    color: '#0c1b1a',
    margin: '8px 0 12px 20px',
  },
  subheading: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '16px',
    fontWeight: 600,
    margin: '16px 0 8px',
  },
});

export default function PrivacyRoute(): React.ReactElement {
  return (
    <section {...stylex.props(layout.card)}>
      <h2 {...stylex.props(contentStyles.heading)}>Privacy Policy</h2>
      <p {...stylex.props(layout.note)}>Last updated: January 29, 2026</p>

      <h3 {...stylex.props(contentStyles.subheading)}>1. Introduction</h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        This Privacy Policy explains how From Trees LLC (&quot;we&quot;,
        &quot;us&quot;, or &quot;our&quot;) collects, uses, and protects
        information when you use MsgStats (the &quot;Service&quot;).
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        2. Information We Collect
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>a. Account Information</p>
      <p {...stylex.props(contentStyles.paragraph)}>
        When you sign in, we may collect:
      </p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>your name,</li>
        <li>email address,</li>
        <li>unique platform identifiers (e.g., user IDs provided by Meta).</li>
      </ul>

      <p {...stylex.props(contentStyles.paragraph)}>
        b. Connected Platform Data
      </p>
      <p {...stylex.props(contentStyles.paragraph)}>
        With your explicit authorization, we may access limited data from
        connected platforms (such as Meta), including:
      </p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>Page identifiers and names,</li>
        <li>messaging metadata (e.g., counts, timestamps),</li>
        <li>
          permissions and access tokens required to retrieve authorized data.
        </li>
      </ul>
      <p {...stylex.props(contentStyles.paragraph)}>
        We do not read or store message content unless explicitly required and
        authorized.
      </p>

      <p {...stylex.props(contentStyles.paragraph)}>c. Technical Information</p>
      <p {...stylex.props(contentStyles.paragraph)}>
        We may collect basic technical data such as:
      </p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>IP address,</li>
        <li>browser type,</li>
        <li>timestamps,</li>
        <li>error logs.</li>
      </ul>

      <h3 {...stylex.props(contentStyles.subheading)}>
        3. How We Use Information
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        We use collected information to:
      </p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>provide and operate the Service,</li>
        <li>generate analytics and reports requested by you,</li>
        <li>maintain security and prevent abuse,</li>
        <li>comply with legal and platform requirements.</li>
      </ul>

      <h3 {...stylex.props(contentStyles.subheading)}>
        4. Data Storage and Security
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        We take reasonable measures to protect data, including:
      </p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>limiting access to authorized systems,</li>
        <li>encrypting sensitive data where appropriate,</li>
        <li>storing access tokens securely.</li>
      </ul>

      <h3 {...stylex.props(contentStyles.subheading)}>5. Data Sharing</h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        We do not sell, rent, or trade personal data. We may share data only:
      </p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>with service providers necessary to operate the Service,</li>
        <li>to comply with legal obligations,</li>
        <li>to comply with platform requirements (such as Meta policies).</li>
      </ul>

      <h3 {...stylex.props(contentStyles.subheading)}>6. Data Retention</h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        We retain data only as long as necessary to provide the Service or as
        required by law. You may request deletion of your data at any time by
        contacting us.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>7. User Rights</h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        Depending on your location, you may have rights to:
      </p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>access your data,</li>
        <li>request correction or deletion,</li>
        <li>withdraw consent for connected platforms.</li>
      </ul>
      <p {...stylex.props(contentStyles.paragraph)}>
        Requests can be made via the contact information below.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        8. Third-Party Platforms
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        The Service relies on third-party platforms (including Meta). Their use
        of your data is governed by their own privacy policies. We encourage you
        to review those policies.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        9. Children&apos;s Privacy
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        The Service is not intended for children under 13, and we do not
        knowingly collect data from children.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        10. Changes to This Policy
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        We may update this Privacy Policy periodically. Changes will be posted
        on this page with an updated effective date.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        11. Contact Information
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        If you have questions or requests regarding this Privacy Policy,
        contact:
      </p>
      <p {...stylex.props(contentStyles.paragraph)}>
        Email: privacy@from-trees.com
        <br />
        Company: From Trees LLC
      </p>
    </section>
  );
}
