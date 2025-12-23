import { createRoot } from 'react-dom/client'

import { routes } from '../.generated/routes'
import { FileRouter } from './router'

const el = document.getElementById('root')
if (!el) throw new Error('Missing <div id="root"></div>')

createRoot(el).render(
	<FileRouter routes={routes} />
)
