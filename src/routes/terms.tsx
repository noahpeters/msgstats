import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

export const meta = () => [{ title: 'Terms of Service | MsgStats' }];

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

export default function TermsRoute(): React.ReactElement {
  return (
    <section {...stylex.props(layout.card)}>
      <h2 {...stylex.props(contentStyles.heading)}>Terms of Service</h2>
      <p {...stylex.props(layout.note)}>Last updated: January 29, 2026</p>

      <h3 {...stylex.props(contentStyles.subheading)}>1. Introduction</h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use
        of MsgStats (the &quot;Service&quot;), operated by From Trees LLC
        (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;). By accessing or
        using the Service, you agree to be bound by these Terms. If you do not
        agree, you may not use the Service.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        2. Description of the Service
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        MsgStats is an analytics and reporting tool that helps users analyze
        messaging activity and related metadata from connected platforms,
        including Meta products such as Facebook Pages and Messenger, where
        authorized by the user. The Service does not modify, send, or respond to
        messages on a user&apos;s behalf.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>3. Eligibility</h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        You must be at least 18 years old and legally able to enter into these
        Terms to use the Service.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        4. User Accounts and Access
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        To use certain features of the Service, you may be required to
        authenticate using third-party services (such as Meta). You are
        responsible for:
      </p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>maintaining the security of your account,</li>
        <li>
          ensuring that you have the right to authorize access to any connected
          accounts or Pages,
        </li>
        <li>all activity that occurs under your account.</li>
      </ul>

      <h3 {...stylex.props(contentStyles.subheading)}>5. Acceptable Use</h3>
      <p {...stylex.props(contentStyles.paragraph)}>You agree not to:</p>
      <ul {...stylex.props(contentStyles.list)}>
        <li>use the Service for unlawful purposes,</li>
        <li>attempt to gain unauthorized access to systems or data,</li>
        <li>interfere with or disrupt the Service,</li>
        <li>
          misuse any third-party APIs or violate third-party platform policies
          (including Meta platform policies).
        </li>
      </ul>

      <h3 {...stylex.props(contentStyles.subheading)}>
        6. Third-Party Services
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        The Service integrates with third-party platforms (including Meta). Your
        use of those services is governed by their respective terms and
        policies. We are not responsible for third-party services or their
        availability.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        7. Intellectual Property
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        All intellectual property rights in the Service, including software,
        branding, and documentation, are owned by or licensed to From Trees LLC.
        You are granted a limited, non-exclusive, non-transferable license to
        use the Service for its intended purpose.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        8. Disclaimer of Warranties
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        The Service is provided &quot;as is&quot; and &quot;as available,&quot;
        without warranties of any kind, express or implied. We do not guarantee
        that the Service will be uninterrupted, error-free, or meet your
        specific requirements.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        9. Limitation of Liability
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        To the maximum extent permitted by law, From Trees LLC shall not be
        liable for any indirect, incidental, special, or consequential damages
        arising out of or related to your use of the Service.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>10. Termination</h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        We may suspend or terminate your access to the Service at any time if
        you violate these Terms or if required by law or platform policy.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        11. Changes to These Terms
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        We may update these Terms from time to time. Continued use of the
        Service after changes become effective constitutes acceptance of the
        updated Terms.
      </p>

      <h3 {...stylex.props(contentStyles.subheading)}>
        12. Contact Information
      </h3>
      <p {...stylex.props(contentStyles.paragraph)}>
        If you have questions about these Terms, you may contact us at:
      </p>
      <p {...stylex.props(contentStyles.paragraph)}>
        Email: support@from-trees.com
        <br />
        Company: From Trees LLC
      </p>
    </section>
  );
}
