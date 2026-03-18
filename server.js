'use strict'

const app = require('./app')

const PORT = process.env.PORT || 3456

app.listen(PORT, () => {
  console.log(`Skill Manager running at http://localhost:${PORT}`)
})
