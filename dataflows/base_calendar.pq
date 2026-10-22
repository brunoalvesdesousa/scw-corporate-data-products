[StagingDefinition = [Kind = "FastCopy"]]
section Section1;
shared base_date = let
    // 1. Hardcoded Setup
    StartDate = #date(2024, 4, 1),
    Today = DateTime.Date(DateTime.LocalNow()),
    FYStartMonth = 4,

    // 2. Generate the Base Date List
    DayCount = Duration.Days(Today - StartDate) + 1,
    Source = List.Dates(StartDate, DayCount, #duration(1, 0, 0, 0)),
    ToTable = Table.FromList(Source, Splitter.SplitByNothing(), {"Date"}, null, ExtraValues.Error),
    #"Typed Date" = Table.TransformColumnTypes(ToTable,{{"Date", type date}}),

    // 3. Add Standard Date Columns
    #"Added Standard" = Table.AddColumn(#"Typed Date", "CustomColumns", each [
        Year = Date.Year([Date]),
        // Keep this as Text for display
        #"Month Year" = Date.ToText([Date], "MMM-yy"),
        // ADD THIS: Numeric Key for sorting (e.g., 202404)
        #"MonthKey" = (Date.Year([Date]) * 100) + Date.Month([Date]),
        Month = Date.ToText([Date], "MMM"),
        #"Month Number" = Date.Month([Date]),
        #"Day of Week" = Date.DayOfWeekName([Date]),
        #"Day of Week Number" = Date.DayOfWeek([Date], Day.Monday) + 1,
        #"Day of the Month Number" = Date.Day([Date])
    ]),
    #"Expanded Standard" = Table.ExpandRecordColumn(#"Added Standard", "CustomColumns", 
        {"Year", "Month Year", "MonthKey", "Month", "Month Number", "Day of Week", "Day of Week Number", "Day of the Month Number"}),

    // 4. Add Financial Year & Week Logic
    #"Added Financial" = Table.AddColumn(#"Expanded Standard", "FinancialColumns", each 
        let 
            CurrentDate = [Date],
            FY_Year = if Date.Month(CurrentDate) >= FYStartMonth then Date.Year(CurrentDate) else Date.Year(CurrentDate) - 1,
            FY_Start = #date(FY_Year, FYStartMonth, 1),
            WeekStart = Date.StartOfWeek(CurrentDate, Day.Monday),
            AnchorDate = Date.StartOfWeek(FY_Start, Day.Monday),
            WeekNum = Number.IntegerDivide(Duration.Days(WeekStart - AnchorDate), 7) + 1
        in [
            #"Financial Year" = Text.From(FY_Year) & "-" & Text.From(FY_Year + 1),
            #"Financial Week Number" = WeekNum,
            #"Financial Week Start" = WeekStart,
            #"Financial Week End" = Date.AddDays(WeekStart, 6),
            #"Financial Week Start Plus 7" = Date.AddDays(WeekStart, 7)
        ]
    ),
    #"Expanded Financial" = Table.ExpandRecordColumn(#"Added Financial", "FinancialColumns", 
        {"Financial Year", "Financial Week Number", "Financial Week Start", "Financial Week End", "Financial Week Start Plus 7"}),

    // 5. Final Data Typing
    #"Final Types" = Table.TransformColumnTypes(#"Expanded Financial", {
        {"Year", Int64.Type}, 
        {"MonthKey", Int64.Type}, 
        {"Month Number", Int64.Type}, 
        {"Day of Week Number", Int64.Type}, 
        {"Day of the Month Number", Int64.Type}, 
        {"Financial Week Number", Int64.Type}, 
        {"Financial Week Start", type date}, 
        {"Financial Week End", type date}, 
        {"Financial Week Start Plus 7", type date}, 
        {"Month Year", type text}, 
        {"Month", type text}, 
        {"Day of Week", type text}, 
        {"Financial Year", type text}
    })
in
    #"Final Types";
