/**
 * The clerk's answer when a number is called that the house never issued:
 * the request stamped and struck through, and two ways back. Brief on
 * purpose — a dead end should not be furnished.
 */
import { useLocation } from 'react-router-dom';
import { ButtonLink, Fleuron, Plate, useTitle } from '../components/ui';

export default function NotFound() {
  useTitle('Not in this supplement');
  const { pathname } = useLocation();

  return (
    <div className="page">
      <Plate className="notfound">
        <p className="eyebrow">Enquiry no. 000</p>

        <p className="strike-stamp">Not in this supplement</p>

        <h1 style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>
          No such page
        </h1>

        <p style={{ color: 'var(--fg-soft)' }}>
          Nothing is filed under{' '}
          <code style={{ wordBreak: 'break-all' }}>{pathname}</code>. It may have been
          withdrawn, or the number mis-struck.
        </p>

        <Fleuron />

        <div className="row" style={{ justifyContent: 'center' }}>
          <ButtonLink to="/" variant="primary">Back to the cover</ButtonLink>
          <ButtonLink to="/catalog">Search the register</ButtonLink>
        </div>
      </Plate>
    </div>
  );
}
