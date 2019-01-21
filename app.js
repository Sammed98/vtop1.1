'use strict'

const App = ((() => {
  // Load in required libs
  const Canvas = require('drawille')
  const blessed = require('blessed')
  const os = require('os')
  const cli = require('commander')
  const upgrade = require('./upgrade.js')
  const VERSION = require('./package.json').version
  const childProcess = require('child_process')
  const glob = require('glob')
  const path = require('path')    // Modules Imported
  let themes = ''                 //Theme name initialization
  let program = blessed.program()  // Class instance

  process.env.LANG = 'en_US.utf8';
  process.env.TERM = 'xterm-256color';

  const files = glob.sync(path.join(__dirname, 'themes', '*.json')) // All theme files
  for (var i = 0; i < files.length; i++) {
    let themeName = files[i].replace(path.join(__dirname, 'themes') + path.sep, '').replace('.json', '') // Replace upto last / and remove .json
    themes += `${themeName}|` // Add | between two themes
  }
  themes = themes.slice(0, -1) // remove the last |

  // Set up the commander instance and add the required options
  cli // command line code
    .option('-t, --theme  [name]', `set the vtop theme [${themes}]`, 'parallax') // Default theme
    .option('--no-mouse', 'Disables mouse interactivity')
    .option('--no-upgrade', 'Disables upgradeNotice, usefull when logging')
    .option('--quit-after [seconds]', 'Quits vtop after interval', '0')
    .option('--update-interval [milliseconds]', 'Interval between updates', '100')
    .version(VERSION)
    .parse(process.argv)

  /**
   * Instance of blessed screen, and the charts object
   */
  let screen
  const charts = []  //Line 196
  let loadedTheme // Next usage line 100
  const intervals = []

  let upgradeNotice = false            // Update the version of Vtop
  let disableTableUpdate = false  // Line 359
  let disableTableUpdateTimeout = setTimeout(() => {}, 0)

  let graphScale = 1    // Used to scale up/down the horizontal axis of graphs. Line 510.

  // Private variables

  /**
   * This is the number of data points drawn
   * @type {Number}
   */
  let position = 0      // Line 350

  const size = {    // Dictionary of dictionaries
    pixel: {                      // Number of pixels of command prompt (Unconfirmed)
      width: 0,
      height: 0
    },
    character: {
      width: 0,
      height: 0
    }
  }

  // @todo: move this into charts array
  // This is an instance of Blessed Box
  let graph       // CPU Graph
  let foot
  let graph2      // Memory Graph
  let processList  // Process List
  let processListSelection  // Selected Process

  // Private functions

  /**
   * Draw header
   * @param  {string} left  This is the text to go on the left
   * @param  {string} right This is the text for the right
   * @return {void}
   */
  const drawHeader = () => {
    let headerText
    let headerTextNoTags
    if (upgradeNotice) { // Line 432
      upgradeNotice = `${upgradeNotice}`
      headerText = ` {bold}vtop{/bold}{white-fg} for {bold}vtop{/bold} {bold} ${os.hostname()} {/bold}{red-bg} Press 'u' to upgrade to v${upgradeNotice} {/red-bg}{/white-fg}`
      headerTextNoTags = ` vtop for ${os.hostname()}  Press 'u' to upgrade to v${upgradeNotice} `
    }

    else {
      headerText = ` {bold}vtop{/bold}{white-fg} for ${os.hostname()} `  // Header Text ka code
      headerTextNoTags = ` vtop for ${os.hostname()} `// Without bold and white-fg tags
    }

    const header = blessed.text({
      top: 'top',
      left: 'left',
      width: headerTextNoTags.length, // Length of vtop for os.hostname
      height: '1',
      fg: loadedTheme.title.fg,
      content: headerText,
      tags: true
    })
    const date = blessed.text({  // This prints time
      top: 'top',
      right: 0,
      width: 9,
      height: '1',
      align: 'right',
      //fg: loadedTheme.title.fg,
      content: '',
      tags: true
    })
    const loadAverage = blessed.text({
      top: 'top',
      height: '1',
      align: 'center',
      content: '',
      tags: true,
      left: Math.floor(program.cols / 2 - (28 / 2))  //28 is the total lenght of Load Average ouptut+Load Average
    })
    screen.append(header) // Display on the screen
    screen.append(date) // Display on the screen
    screen.append(loadAverage)  // Display on the screen

    const zeroPad = input => (`0${input}`).slice(-2)

    const updateTime = () => {
      const time = new Date()
      date.setContent(`${zeroPad(time.getHours())}:${zeroPad(time.getMinutes())}:${zeroPad(time.getSeconds())} `)
      screen.render() // Values update
    }

    const updateLoadAverage = () => {
      const avg = os.loadavg()
      loadAverage.setContent(`Load Average: ${avg[0].toFixed(2)} ${avg[1].toFixed(2)} ${avg[2].toFixed(2)}`)
      screen.render()
    }

    updateTime() // Update Time
    updateLoadAverage() //Update Load Average
    setInterval(updateTime, 1000) // Run the function every second
    setInterval(updateLoadAverage, 1000) // Run the function every second
  }


  /**
   * Repeats a string
   * @var string The string to repeat
   * @var integer The number of times to repeat
   * @return {string} The repeated chars as a string.
   */
  const stringRepeat = (string, num) => {    //dont know
    if (num < 0) {
      return ''
    }
    return new Array(num + 1).join(string)
  }

  /**
   * This draws a chart
   * @param  {int} chartKey The key of the chart.
   * @return {string}       The text output to draw.
   */
  const drawChart = chartKey => {
    const chart = charts[chartKey]    // charts is a list. 0th index->CPU usage graph values, index 1 -> memory usage, index 2 -> table.
    const c = chart.chart             //Width, content, buffer, height, canvas.
    c.clear()

    if (!charts[chartKey].plugin.initialized) {
      return false
    }

    const dataPointsToKeep = 5000   //Number of points to keep track on the horizontal axis
    if (chartKey === 1){
      charts[chartKey].swapvalues[position] = charts[chartKey].plugin.swapValue
      charts[chartKey].avail[position] = charts[chartKey].plugin.available
    }
    charts[chartKey].values[position] = charts[chartKey].plugin.currentValue    // Values is an array which stores the respective values.

    const computeValue = input => chart.height - Math.floor(((chart.height + 1) / 100) * input) - 1

    if (position > dataPointsToKeep) {
      delete charts[chartKey].values[position - dataPointsToKeep]   // Keep only the points which can be shown on the screen.
    }
    // Values of CPU have initial 4 empty values and then the original values get appended. Same with the memory with 1 empty space.
    for (const pos in charts[chartKey].values) {    // Iterating through the list.

      if (graphScale >= 1 || (graphScale < 1 && pos % (1 / graphScale) === 0)) {
        const p = parseInt(pos, 10) + (chart.width - charts[chartKey].values.length)    // Scope for optimization. charts[chartKey]=chart
        // calculated x-value based on graphScale
        const x = (p * graphScale) + ((1 - graphScale) * chart.width)

        // draws top line of chart
        if (p > 1 && computeValue(charts[chartKey].values[pos - 1]) > 0) {
          c.set(x, computeValue(charts[chartKey].values[pos - 1]))
        }

        // Start deleting old data points to improve performance
        // @todo: This is not be the best place to do this

        // fills all area underneath top line

      }
    }

    // Add percentage to top right of the chart by splicing it into the braille data
    const textOutput = c.frame().split('\n')

    const percent = `   ${chart.plugin.currentValue}`
    const swapPercent = `   ${chart.plugin.swapValue}`
    let ava = `   ${chart.plugin.available}`
    if (chartKey === 1){
      if (ava < 1024)
        textOutput[0] = `${textOutput[0].slice(0, textOutput[0].length - 42)}{white-fg}${percent.slice(-3)}% (Swap Space${swapPercent.slice(-3)}%) [${ava}MB available]{/white-fg}`
      else {
        ava /= 1024
        ava = parseFloat( ava.toFixed(1) )
        textOutput[0] = `${textOutput[0].slice(0, textOutput[0].length - 40)}{white-fg}${percent.slice(-3)}% (Swap Space${swapPercent.slice(-3)}%) [${ava}GB available]{/white-fg}`
      }
    }
    else{
      textOutput[0] = `${textOutput[0].slice(0, textOutput[0].length - 4)}{white-fg}${percent.slice(-3)}%{/white-fg}`
  }
    return textOutput.join('\n')
  }

  /**
   * Draws a table.
   * @param  {int} chartKey The key of the chart.
   * @return {string}       The text output to draw.
   */
  const drawTable = chartKey => {
    const chart = charts[chartKey]
    const columnLengths = {}
    // Clone the column array
    const columns = chart.plugin.columns.slice(0)  // Column headers
    columns.reverse()
    let removeColumn = false
    const lastItem = columns[columns.length - 1]  // Last item is command heading

    const minimumWidth = 12
    let padding = 1

    if (chart.width > 50) {
      padding = 2             //Padding between columns
    }

    if (chart.width > 80) {
      padding = 3
    }
    // Keep trying to reduce the number of columns
    do {    // ******* SKIPPED *******
      let totalUsed = 0   // Total used space by all the columns.
      let firstLength = 0
      // var totalColumns = columns.length
      // Allocate space for each column in reverse order
      for (const column in columns) {
        const item = columns[column]    // Item is individual heading
        i++
        // If on the last column (actually first because of array order)
        // then use up all the available space
        if (item === lastItem) {
          columnLengths[item] = chart.width - totalUsed
          firstLength = columnLengths[item]
        } else {
          columnLengths[item] = item.length + padding
        }
        totalUsed += columnLengths[item]
      }
      if (firstLength < minimumWidth && columns.length > 1) {
        totalUsed = 0
        columns.shift()
        removeColumn = true
      } else {
        removeColumn = false
      }
    } while (removeColumn)    // ******* SKIPPED *******

    // And back again
    columns.reverse()
    let titleOutput = '{bold}'
    for (const headerColumn in columns) {
      var colText = ` ${columns[headerColumn]}`
      titleOutput += (colText + stringRepeat(' ', columnLengths[columns[headerColumn]] - colText.length))
    }
    titleOutput += '{/bold}' + '\n'

    const bodyOutput = []
    for (const row in chart.plugin.currentValue) {
      const currentRow = chart.plugin.currentValue[row]
      let rowText = ''
      for (const bodyColumn in columns) {
        let colText = ` ${currentRow[columns[bodyColumn]]}`
        rowText += (colText + stringRepeat(' ', columnLengths[columns[bodyColumn]] - colText.length)).slice(0, columnLengths[columns[bodyColumn]])
      }
      bodyOutput.push(rowText)
    }
    return {
      title: titleOutput,
      body: bodyOutput,
      processWidth: columnLengths[columns[0]]
    }
  }





  // This is set to the current items displayed
  let currentItems = []
  let processWidth = 0
  /**
   * Overall draw function, this should poll and draw results of
   * the loaded sensors.
   */
  const draw = () => {
    position++

    const chartKey = 0
    // console.log(graph)
    graph.setContent(drawChart(chartKey))
    // console.log(graph)
    graph2.setContent(drawChart(chartKey + 1))

    if (!disableTableUpdate) {
      const table = drawTable(chartKey + 2)
      processList.setContent(table.title)

      // If we keep the stat numbers the same immediately, then update them
      // after, the focus will follow. This is a hack.

      const existingStats = {}
      // Slice the start process off, then store the full stat,
      // so we can inject the same stat onto the new order for a brief render
      // cycle.
      for (var stat in currentItems) {
        var thisStat = currentItems[stat]
        existingStats[thisStat.slice(0, table.processWidth)] = thisStat
      }
      processWidth = table.processWidth
      // Smush on to new stats
      const tempStats = []
      for (let stat in table.body) {
        let thisStat = table.body[stat]
        tempStats.push(existingStats[thisStat.slice(0, table.processWidth)])
      }
      // Move cursor  with temp stats
      // processListSelection.setItems(tempStats);

      // Update the numbers
      processListSelection.setItems(table.body)

      processListSelection.focus()

      currentItems = table.body
    }

    screen.render()
  }

  // Public function (just the entry point)
  return {

    init () {
      let theme    //controversial
      if (typeof process.theme !== 'undefined') {
        theme = process.theme
      } else {
        theme = cli.theme
      }


      // theme variable will have Theme name
      /**
       * Quits running vtop after so many seconds
       * This is mainly for perf testing.
       */
      if (cli['quitAfter'] !== '0') {
        setTimeout(() => {
          process.exit(0)
        }, parseInt(cli['quitAfter'], 10) * 1000) //Second argument is base. First argument is the time after wihch the process shold quit
      }
      //console.log(cli)
      try {
        loadedTheme = require(`./themes/${theme}.json`) //Load the theme.json
      } catch (e) {
        console.log(`The theme '${theme}' does not exist.`)
        process.exit(1)
      }


      // Create a screen object.
      screen = blessed.screen()

      // Configure 'q', esc, Ctrl+C for quit
      let upgrading = false

      const doCheck = () => {
        upgrade.check(v => {
          upgradeNotice = v
          drawHeader()
        })
      }

      doCheck()
      // Check for updates every 5 minutes
      if (cli.upgrade == true) {
        setInterval(doCheck, 300000);
      }


      let lastKey = ''

      screen.on('keypress', (ch, key) => {
        if (key.full === 'up' || key.full === 'down' || key.full === 'k' || key.full === 'j') {
          // Disable table updates for half a second
          disableTableUpdate = true
          clearTimeout(disableTableUpdateTimeout)
          disableTableUpdateTimeout = setTimeout(() => {
            disableTableUpdate = false
          }, 1000)  //Clear the initialized setTimeout
        }

        if (
          upgrading === false &&
          (
            key.name === 'q' ||
            key.name === 'escape' ||
            (key.name === 'c' && key.ctrl === true)
          )
        ) {
          return process.exit(0)
        }


        // dd killall
        // @todo: Factor this out
        if (lastKey === 'd' && key.name === 'd') {
          let selectedProcess = processListSelection.getItem(processListSelection.selected).content
          selectedProcess = selectedProcess.slice(0, processWidth).trim()

          childProcess.exec(`killall "${selectedProcess}"`, () => {})   //Shell command to kill the highlighted process
        }

        if (key.name === 'c' && charts[2].plugin.sort !== 'cpu') {
          charts[2].plugin.sort = 'cpu'
          charts[2].plugin.poll()
          setTimeout(() => {
            processListSelection.select(0)
          }, 200)
        }
        if (key.name === 'm' && charts[2].plugin.sort !== 'mem') {
          charts[2].plugin.sort = 'mem'
          charts[2].plugin.poll()
          setTimeout(() => {
            processListSelection.select(0)
          }, 200)
        }
        lastKey = key.name

        if (key.name === 'u' && upgrading === false) {
          upgrading = true
          // Clear all intervals
          for (const interval in intervals) {
            clearInterval(intervals[interval])
          }
          processListSelection.detach()
          program = blessed.program()
          program.clear()
          program.disableMouse()
          program.showCursor()
          program.normalBuffer()

          // @todo: show changelog  AND  smush existing data into it :D
          upgrade.install('vtop', [
            {
              'theme': theme
            }
          ])
        }

        if ((key.name === 'left' || key.name === 'h') && graphScale < 8) {
          graphScale *= 2
        } else if ((key.name === 'right' || key.name === 'l') && graphScale > 0.125) {
          graphScale /= 2
        }
      })

      drawHeader()

      // setInterval(drawHeader, 1000);

      graph = blessed.box({
        top: 1,
        left: 'left',
        width: '100%',
        height: '48%',
        content: '',
        fg: loadedTheme.chart.fg,
        tags: true,
        border: loadedTheme.chart.border
      })



      screen.append(graph)

      let graph2appended = false

      const createBottom = () => {
        if (graph2appended) {
          screen.remove(graph2)
          screen.remove(foot)
          screen.remove(processList)
        }
        graph2appended = true
        graph2 = blessed.box({
          top: graph.height + 1,
          left: 'left',
          width: '50%',
          height: graph.height - 4,    //Possible BUG.
                                        //Memory value not showing correct BUG
          content: '',
          fg: loadedTheme.chart.fg,
          tags: true,
          border: loadedTheme.chart.border
        })
        screen.append(graph2)

        foot = blessed.box({
          top: graph2.top + graph2.height,
          left: 'left',
          height: 4,
          width: '100%',
          content: '{white-fg}dd{/white-fg}:Kill process {white-fg}j{/white-fg}:Down {white-fg}k{/white-fg}:Up {white-fg}g{/white-fg}:Jump to top {white-fg}G{/white-fg}:Jump to bottom {white-fg}c{/white-fg}:Sort by CPU {white-fg}m{/white-fg}:Sort by Mem',
          fg: loadedTheme.chart.fg,
          tags: true,
          border: loadedTheme.chart.border
        })

        screen.append(foot)

        processList = blessed.box({
          top: graph.height + 1,
          left: '50%',
          width: screen.width - graph2.width,
          height: graph.height - 4,
          keys: true,
          mouse: cli.mouse,
          fg: loadedTheme.table.fg,
          tags: true,
          border: loadedTheme.table.border,
        })
        screen.append(processList)

        processListSelection = blessed.list({
          height: processList.height - 3,
          top: 1,
          width: processList.width - 2,
          left: 0,
          keys: true,
          vi: true,
          search (jump) {
            // @TODO
            // jump('string of thing to jump to');   CAN DO BUG
          },
          style: loadedTheme.table.items,
          mouse: cli.mouse,
          // alwaysScroll:true,
          scrollable: true,
          scrollbar: {
            style: {
              bg: 'yellow'
            }
          }
        })
        processList.append(processListSelection)
        processListSelection.focus()
        screen.render()
      }

      screen.on('resize', () => {
        createBottom()
      })
      createBottom()

      screen.append(graph)
      screen.append(foot)
      screen.append(processList)

      // Render the screen.
      screen.render()

      const setupCharts = () => {
        size.pixel.width = (graph.width - 2) * 2
        size.pixel.height = (graph.height - 2) * 4

        const plugins = ['cpu', 'memory', 'process']

        for (const plugin in plugins) {
          let width
          let height
          let currentCanvas
          // @todo Refactor this
          switch (plugins[plugin]) {
            case 'cpu':
              width = (graph.width - 3) * 2
              height = (graph.height - 2) * 4
              currentCanvas = new Canvas(width, height)
              break
            case 'memory':
              width = (graph2.width - 3) * 2
              height = ((graph2.height - 2) * 4)
              currentCanvas = new Canvas(width, height)
              break
            case 'process':
              width = processList.width - 3
              height = processList.height - 2
              break
          }

          // If we're reconfiguring a plugin, then preserve the already recorded values
          let values
          let swapvalues
          let avail
          if (typeof charts[plugin] !== 'undefined' && typeof charts[plugin].values !== 'undefined') {
            values = charts[plugin].values
          } else {
            values = []
          }
          if (typeof charts[plugin] !== 'undefined' && typeof charts[plugin].swapvalues !== 'undefined' && typeof charts[plugin].avail !== 'undefined') {
            swapvalues = charts[plugin].swapvalues
            avail = charts[plugin].avail
          } else {
            swapvalues = []
            avail = []
          }
          charts[plugin] = {
            chart: currentCanvas,
            values,
            swapvalues,
            avail,
            plugin: require(`./sensors/${plugins[plugin]}.js`),
            width,
            height
          }
          charts[plugin].plugin.poll()
        }
        // @TODO Make this less hard-codey
        graph.setLabel(` ${charts[0].plugin.title} `)
        graph2.setLabel(` ${charts[1].plugin.title} `)
        foot.setLabel(` ${'Commands'}`)
        processList.setLabel(` ${charts[2].plugin.title} `)
      }

      setupCharts()
      screen.on('resize', setupCharts)
      intervals.push(setInterval(draw, parseInt(cli['updateInterval'], 10)))

      // @todo Make this more sexy
      intervals.push(setInterval(charts[0].plugin.poll, charts[0].plugin.interval))
      intervals.push(setInterval(charts[1].plugin.poll, charts[1].plugin.interval))
      intervals.push(setInterval(charts[2].plugin.poll, charts[2].plugin.interval))
    }
  }
})())

App.init()
