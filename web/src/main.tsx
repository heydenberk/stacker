import { render } from 'preact';
import { catalog } from './crates';

render(<p>Stacker — {catalog.order.length} crate(s) bundled</p>, document.getElementById('app')!);
